const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  ANTHROPIC_USAGE_URL,
  ANTHROPIC_OAUTH_TOKEN_URL,
  CODEX_USAGE_URL,
  OPENAI_OAUTH_TOKEN_URL,
} = require("../src/constants");
const {
  loadLiveUsage,
  normalizeAnthropicUsage,
  normalizeCodexUsage,
  normalizeGeminiUsage,
} = require("../src/lib/liveUsage");

const tempDirs = [];
const originalFetch = global.fetch;

test.afterEach(async () => {
  if (originalFetch) {
    global.fetch = originalFetch;
  } else {
    delete global.fetch;
  }

  await Promise.all(
    tempDirs.splice(0).map((dirPath) => fs.rm(dirPath, { recursive: true, force: true })),
  );
});

function createJsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function createTextResponse(text, { ok = false, status = 500 } = {}) {
  return {
    ok,
    status,
    async json() {
      throw new Error("JSON not available");
    },
    async text() {
      return text;
    },
  };
}

async function createAuthPaths(openCodeAuth = {}, codexAuth = {}) {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), "live-usage-"));
  tempDirs.push(dirPath);

  const paths = {
    openCodeAuthPath: path.join(dirPath, "opencode-auth.json"),
    codexAuthPath: path.join(dirPath, "codex-auth.json"),
  };

  await Promise.all([
    fs.writeFile(paths.openCodeAuthPath, `${JSON.stringify(openCodeAuth)}\n`, "utf8"),
    fs.writeFile(paths.codexAuthPath, `${JSON.stringify(codexAuth)}\n`, "utf8"),
  ]);

  return paths;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function installFetchMock(handlers) {
  const calls = [];
  let index = 0;

  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    assert.ok(index < handlers.length, `Unexpected fetch call ${url}`);
    const handler = handlers[index];
    index += 1;
    return handler(url, options);
  };

  return calls;
}

test("normalizeAnthropicUsage extracts rate limits and billing", () => {
  const normalized = normalizeAnthropicUsage({
    five_hour: { utilization: 0.25, resets_at: Date.now() + 3600_000 },
    seven_day: { utilization: 0.5, resets_at: Date.now() + 7200_000 },
    extra_usage: { is_enabled: true, used_credits: 20, monthly_limit: 100 },
  });

  assert.equal(normalized.provider, "anthropic");
  assert.equal(normalized.windows.length, 2);
  assert.equal(normalized.windows[0].percentUsed, 25);
  assert.equal(normalized.billing.percentUsed, 20);
});

test("normalizeCodexUsage extracts primary and secondary windows", () => {
  const normalized = normalizeCodexUsage({
    plan_type: "pro",
    rate_limit: {
      primary_window: {
        used_percent: 15,
        reset_at: Date.now() + 3600_000,
        limit_window_seconds: 5 * 3600,
      },
      secondary_window: {
        used_percent: 45,
        reset_at: Date.now() + 7200_000,
        limit_window_seconds: 7 * 24 * 3600,
      },
      limit_reached: false,
    },
  });

  assert.equal(normalized.provider, "openai");
  assert.equal(normalized.windows.length, 2);
  assert.equal(normalized.windows[0].label, "5h");
  assert.equal(normalized.windows[1].label, "7d");
});

test("normalizeGeminiUsage keeps Gemini estimate-only", () => {
  const normalized = normalizeGeminiUsage();

  assert.deepEqual(normalized, {
    provider: "google",
    label: "Gemini",
    windows: [],
    billing: null,
    limitReached: null,
    estimateOnly: true,
  });
});

test("loadLiveUsage refreshes before using raw codex access when refresh is available", async () => {
  const paths = await createAuthPaths(
    { openai: { refresh: "openai-refresh" } },
    { tokens: { access_token: "raw-codex-access", refresh_token: "codex-refresh" } },
  );
  const calls = installFetchMock([
    (url, options) => {
      assert.equal(url, OPENAI_OAUTH_TOKEN_URL);
      assert.match(options.body, /refresh_token=openai-refresh/);
      return createJsonResponse({ access_token: "fresh-access", expires_in: 1800 });
    },
    (url, options) => {
      assert.equal(url, CODEX_USAGE_URL);
      assert.equal(options.headers.Authorization, "Bearer fresh-access");
      return createJsonResponse({
        plan_type: "pro",
        rate_limit: {
          primary_window: { used_percent: 10, reset_at: Date.now() + 60_000, limit_window_seconds: 18_000 },
        },
      });
    },
  ]);

  const result = await loadLiveUsage(paths);
  const updatedOpenCodeAuth = await readJson(paths.openCodeAuthPath);
  const updatedCodexAuth = await readJson(paths.codexAuthPath);

  assert.equal(calls.length, 2);
  assert.equal(result.providers.length, 1);
  assert.deepEqual(result.diagnostics, ["Gemini API key missing or invalid"]);
  assert.equal(updatedOpenCodeAuth.openai.access, "fresh-access");
  assert.equal(updatedCodexAuth.tokens.access_token, "fresh-access");
});

test("loadLiveUsage does not skip refresh when OpenAI access has no expiry", async () => {
  const paths = await createAuthPaths(
    { openai: { access: "missing-expiry-access", refresh: "openai-refresh" } },
    { tokens: { access_token: "raw-codex-access" } },
  );
  const calls = installFetchMock([
    (url, options) => {
      assert.equal(url, OPENAI_OAUTH_TOKEN_URL);
      assert.match(options.body, /refresh_token=openai-refresh/);
      return createJsonResponse({ access_token: "fresh-access", expires_in: 1800 });
    },
    (url, options) => {
      assert.equal(url, CODEX_USAGE_URL);
      assert.equal(options.headers.Authorization, "Bearer fresh-access");
      return createJsonResponse({
        plan_type: "pro",
        rate_limit: {
          primary_window: { used_percent: 10, reset_at: Date.now() + 60_000, limit_window_seconds: 18_000 },
        },
      });
    },
  ]);

  const result = await loadLiveUsage(paths);

  assert.equal(calls.length, 2);
  assert.equal(result.providers.length, 1);
  assert.deepEqual(result.diagnostics, ["Gemini API key missing or invalid"]);
});

test("loadLiveUsage retries with a forced refresh after Codex auth errors", async () => {
  const paths = await createAuthPaths({
    openai: {
      access: "stale-openai-access",
      expires: Date.now() + 60_000,
      refresh: "openai-refresh",
    },
  });
  const calls = installFetchMock([
    (url, options) => {
      assert.equal(url, CODEX_USAGE_URL);
      assert.equal(options.headers.Authorization, "Bearer stale-openai-access");
      return createTextResponse("expired", { status: 401 });
    },
    (url, options) => {
      assert.equal(url, OPENAI_OAUTH_TOKEN_URL);
      assert.match(options.body, /refresh_token=openai-refresh/);
      return createJsonResponse({ access_token: "fresh-access", expires_in: 1800 });
    },
    (url, options) => {
      assert.equal(url, CODEX_USAGE_URL);
      assert.equal(options.headers.Authorization, "Bearer fresh-access");
      return createJsonResponse({
        plan_type: "pro",
        rate_limit: {
          primary_window: { used_percent: 20, reset_at: Date.now() + 60_000, limit_window_seconds: 18_000 },
        },
      });
    },
  ]);

  const result = await loadLiveUsage(paths);

  assert.equal(calls.length, 3);
  assert.equal(result.providers.length, 1);
  assert.deepEqual(result.diagnostics, ["Gemini API key missing or invalid"]);
});

test("loadLiveUsage reports Claude auth expired without retrying stale Anthropic access", async () => {
  const paths = await createAuthPaths({
    anthropic: {
      access: "stale-anthropic-access",
      expires: Date.now() - 60_000,
    },
  });
  const calls = installFetchMock([
    (url, options) => {
      assert.equal(url, ANTHROPIC_USAGE_URL);
      assert.equal(options.headers.Authorization, "Bearer stale-anthropic-access");
      return createTextResponse("expired", { status: 401 });
    },
  ]);

  const result = await loadLiveUsage(paths);

  assert.equal(calls.length, 1);
  assert.deepEqual(result.providers, []);
  assert.deepEqual(result.diagnostics, [
    "Claude auth expired",
    "Codex not configured",
    "Gemini API key missing or invalid",
  ]);
});

test("loadLiveUsage reports Anthropic refresh failures distinctly", async () => {
  const paths = await createAuthPaths({
    anthropic: {
      refresh: "anthropic-refresh",
    },
  });
  const calls = installFetchMock([
    (url, options) => {
      assert.equal(url, ANTHROPIC_OAUTH_TOKEN_URL);
      assert.equal(options.method, "POST");
      assert.match(options.body, /"refresh_token":"anthropic-refresh"/);
      return createTextResponse("denied", { status: 400 });
    },
  ]);

  const result = await loadLiveUsage(paths);

  assert.equal(calls.length, 1);
  assert.deepEqual(result.providers, []);
  assert.deepEqual(result.diagnostics, [
    "Claude auth refresh failed: Anthropic refresh 400: denied",
    "Codex not configured",
    "Gemini API key missing or invalid",
  ]);
});

test("loadLiveUsage reports non-throwing diagnostics when Codex auth and google entry are both absent", async () => {
  const paths = await createAuthPaths();

  await assert.doesNotReject(async () => {
    const result = await loadLiveUsage(paths);

    assert.equal(result.providers.length, 0);
    assert.deepEqual(result.diagnostics, ["Codex not configured", "Gemini API key missing or invalid"]);
  });
});

test("loadLiveUsage recognizes Gemini from the OpenCode google API key without live quota fetches", async () => {
  const paths = await createAuthPaths({ google: { key: "gemini-api-key" } });
  const calls = installFetchMock([]);

  const result = await loadLiveUsage(paths);

  assert.equal(calls.length, 0);
  assert.deepEqual(result.providers, [normalizeGeminiUsage()]);
  assert.deepEqual(result.diagnostics, ["Codex not configured"]);
});

test("loadLiveUsage reports a non-throwing Gemini diagnostic when google.key is missing", async () => {
  const paths = await createAuthPaths({ google: {} });
  const calls = installFetchMock([]);

  await assert.doesNotReject(async () => {
    const result = await loadLiveUsage(paths);

    assert.equal(calls.length, 0);
    assert.deepEqual(result.providers, []);
    assert.deepEqual(result.diagnostics, ["Codex not configured", "Gemini API key missing or invalid"]);
  });
});

test("loadLiveUsage reports a non-throwing Gemini diagnostic when google.key is invalid", async () => {
  const paths = await createAuthPaths({ google: { key: 42 } });
  const calls = installFetchMock([]);

  await assert.doesNotReject(async () => {
    const result = await loadLiveUsage(paths);

    assert.equal(calls.length, 0);
    assert.deepEqual(result.providers, []);
    assert.deepEqual(result.diagnostics, ["Codex not configured", "Gemini API key missing or invalid"]);
  });
});

test("loadLiveUsage reports Codex auth expired when refresh is unavailable", async () => {
  const paths = await createAuthPaths({
    openai: {
      access: "expired-openai-access",
      expires: Date.now() - 60_000,
    },
  });

  const result = await loadLiveUsage(paths);

  assert.equal(result.providers.length, 0);
  assert.deepEqual(result.diagnostics, ["Codex auth expired", "Gemini API key missing or invalid"]);
});

test("loadLiveUsage reports Codex auth refresh failures distinctly", async () => {
  const paths = await createAuthPaths({ openai: { refresh: "openai-refresh" } });
  const calls = installFetchMock([
    (url, options) => {
      assert.equal(url, OPENAI_OAUTH_TOKEN_URL);
      assert.match(options.body, /refresh_token=openai-refresh/);
      return createTextResponse("denied", { status: 400 });
    },
  ]);

  const result = await loadLiveUsage(paths);

  assert.equal(calls.length, 1);
  assert.deepEqual(result.providers, []);
  assert.deepEqual(result.diagnostics, [
    "Codex auth refresh failed: OpenAI refresh 400: denied",
    "Gemini API key missing or invalid",
  ]);
});

test("loadLiveUsage reports Codex fetch failures distinctly", async () => {
  const paths = await createAuthPaths({
    openai: {
      access: "valid-openai-access",
      expires: Date.now() + 60_000,
    },
  });
  const calls = installFetchMock([
    (url, options) => {
      assert.equal(url, CODEX_USAGE_URL);
      assert.equal(options.headers.Authorization, "Bearer valid-openai-access");
      return createTextResponse("upstream down", { status: 500 });
    },
  ]);

  const result = await loadLiveUsage(paths);

  assert.equal(calls.length, 1);
  assert.deepEqual(result.providers, []);
  assert.deepEqual(result.diagnostics, [
    "Codex fetch failed: Codex 500: upstream down",
    "Gemini API key missing or invalid",
  ]);
});
