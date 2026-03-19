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
  loadGeminiCliUsage,
  normalizeAnthropicUsage,
  normalizeCodexUsage,
  normalizeGeminiCliUsage,
  normalizeGeminiUsage,
  parseGeminiCliQuota,
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

async function createAuthPaths(openCodeAuth = {}, codexAuth = {}, openCodeConfig = {}) {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), "live-usage-"));
  tempDirs.push(dirPath);

  const paths = {
    openCodeAuthPath: path.join(dirPath, "opencode-auth.json"),
    openCodeConfigPath: path.join(dirPath, "opencode.json"),
    codexAuthPath: path.join(dirPath, "codex-auth.json"),
  };

  await Promise.all([
    fs.writeFile(paths.openCodeAuthPath, `${JSON.stringify(openCodeAuth)}\n`, "utf8"),
    fs.writeFile(paths.openCodeConfigPath, `${JSON.stringify(openCodeConfig)}\n`, "utf8"),
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
    extra_usage: { is_enabled: true, used_credits: 6237, monthly_limit: 15000 },
  });

  assert.equal(normalized.provider, "anthropic");
  assert.equal(normalized.windows.length, 2);
  assert.equal(normalized.windows[0].percentUsed, 25);
  assert.equal(normalized.billing.amountUsed, 62.37);
  assert.equal(normalized.billing.amountLimit, 150);
  assert.equal(normalized.billing.percentUsed, 42);
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

test("normalizeGeminiCliUsage converts Gemini CLI quota into a live provider window", () => {
  const normalized = normalizeGeminiCliUsage({
    pooledRemaining: 85,
    pooledLimit: 100,
    pooledResetTime: new Date(Date.now() + 3600_000).toISOString(),
  });

  assert.equal(normalized.provider, "google");
  assert.equal(normalized.estimateOnly, false);
  assert.equal(normalized.windows[0].label, "1d");
  assert.equal(normalized.windows[0].percentUsed, 15);
});

test("parseGeminiCliQuota finds pooled quota fields inside JSON output", () => {
  const parsed = parseGeminiCliQuota(`Loaded cached credentials.\n{"type":"model_stats","pooledRemaining":85,"pooledLimit":100,"pooledResetTime":"2025-01-01T12:00:00Z"}`);

  assert.deepEqual(parsed, {
    type: "model_stats",
    pooledRemaining: 85,
    pooledLimit: 100,
    pooledResetTime: "2025-01-01T12:00:00Z",
  });
});

test("loadGeminiCliUsage reads Gemini quota from non-interactive JSON output", async () => {
  const result = await loadGeminiCliUsage({}, {
    execFileAsync: async (command, args) => {
      assert.equal(command, "gemini");
      assert.deepEqual(args, ["-o", "json", "-y", "/stats model"]);
      return {
        stdout: '{"type":"model_stats","pooledRemaining":85,"pooledLimit":100,"pooledResetTime":"2025-01-01T12:00:00Z"}',
        stderr: "",
      };
    },
  });

  assert.equal(result.detected, true);
  assert.equal(result.provider.provider, "google");
  assert.equal(result.provider.windows[0].percentUsed, 15);
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

test("loadLiveUsage preserves the last Claude provider during Anthropic backoff", async () => {
  const paths = await createAuthPaths({ google: { key: "gemini-api-key" } });

  const result = await loadLiveUsage(paths, {
    anthropicBackoffUntil: Date.now() + 60_000,
    anthropicProvider: {
      provider: "anthropic",
      label: "Claude",
      windows: [{ id: "anthropic-5h", label: "5h", percentUsed: 12, resetText: "2h 1m" }],
      billing: null,
      limitReached: false,
    },
  });

  assert.deepEqual(result.providers, [
    {
      provider: "anthropic",
      label: "Claude",
      windows: [{ id: "anthropic-5h", label: "5h", percentUsed: 12, resetText: "2h 1m" }],
      billing: null,
      limitReached: false,
    },
    normalizeGeminiUsage(),
  ]);
  assert.deepEqual(result.diagnostics, ["Claude rate limited; using backoff window", "Codex not configured"]);
});

test("loadLiveUsage reuses fresh shared Claude cache instead of fetching again", async () => {
  const paths = await createAuthPaths({
    anthropic: {
      access: "anthropic-access",
      expires: Date.now() + 60_000,
    },
    google: { key: "gemini-api-key" },
  });
  const calls = installFetchMock([]);

  const cache = {
    provider: {
      provider: "anthropic",
      label: "Claude",
      windows: [{ id: "anthropic-5h", label: "5h", percentUsed: 11, resetText: "2h" }],
      billing: null,
      limitReached: false,
    },
    backoffUntil: 0,
    diagnostics: [],
    refreshedAt: Date.now(),
  };

  const result = await loadLiveUsage(paths, {}, {}, {
    sharedState: {
      fs: {
        readFile: async (filePath) => {
          if (filePath.endsWith("claude-live-usage.json")) return JSON.stringify(cache);
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
        mkdir: async () => {},
        writeFile: async () => {},
        rename: async () => {},
        rm: async () => {},
      },
    },
  });

  assert.equal(calls.length, 0);
  assert.deepEqual(result.providers, [cache.provider, normalizeGeminiUsage()]);
  assert.deepEqual(result.diagnostics, ["Codex not configured"]);
});

test("loadLiveUsage waits for a sibling lease holder instead of fetching Claude directly", async () => {
  const paths = await createAuthPaths({
    anthropic: {
      access: "anthropic-access",
      expires: Date.now() + 60_000,
    },
    google: { key: "gemini-api-key" },
  });
  const calls = installFetchMock([]);
  const freshCache = {
    provider: {
      provider: "anthropic",
      label: "Claude",
      windows: [{ id: "anthropic-5h", label: "5h", percentUsed: 17, resetText: "1h" }],
      billing: null,
      limitReached: false,
    },
    backoffUntil: 0,
    diagnostics: [],
    refreshedAt: Date.now() + 10,
  };
  let cacheReads = 0;

  const result = await loadLiveUsage(paths, {}, {}, {
    sharedState: {
      fs: {
        readFile: async (filePath) => {
          if (filePath.endsWith("owner.json")) return JSON.stringify({ holderId: "other", expiresAt: Date.now() + 60_000 });
          if (filePath.endsWith("claude-live-usage.json")) {
            cacheReads += 1;
            if (cacheReads < 2) {
              throw Object.assign(new Error("missing"), { code: "ENOENT" });
            }
            return JSON.stringify(freshCache);
          }
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
        mkdir: async (filePath) => {
          if (!String(filePath).endsWith("claude-live-usage.lock")) {
            return;
          }
          const error = new Error("exists");
          error.code = "EEXIST";
          throw error;
        },
        writeFile: async () => {},
        rename: async () => {},
        rm: async () => {},
      },
      sleep: async () => {},
    },
  });

  assert.equal(calls.length, 0);
  assert.deepEqual(result.providers, [freshCache.provider, normalizeGeminiUsage()]);
  assert.deepEqual(result.diagnostics, ["Codex not configured"]);
});

test("loadLiveUsage reuses fresh shared Codex cache instead of fetching again", async () => {
  const paths = await createAuthPaths({ google: { key: "gemini-api-key" } });
  const calls = installFetchMock([]);
  const cache = {
    provider: {
      provider: "openai",
      label: "Codex",
      planType: "pro",
      windows: [{ id: "openai-primary", label: "5h", percentUsed: 14, resetText: "30m" }],
      billing: null,
      limitReached: false,
    },
    diagnostics: [],
    refreshedAt: Date.now(),
  };

  const result = await loadLiveUsage(paths, {}, {}, {
    sharedState: {
      fs: {
        readFile: async (filePath) => {
          if (filePath.endsWith("claude-live-usage.json") || filePath.endsWith("claude-live-usage.lock/owner.json")) {
            throw Object.assign(new Error("missing"), { code: "ENOENT" });
          }
          if (filePath.endsWith("codex-live-usage.json")) return JSON.stringify(cache);
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
        mkdir: async () => {},
        writeFile: async () => {},
        rename: async () => {},
        rm: async () => {},
      },
    },
  });

  assert.equal(calls.length, 0);
  assert.deepEqual(result.providers, [cache.provider, normalizeGeminiUsage()]);
  assert.deepEqual(result.diagnostics, []);
});

test("loadLiveUsage waits for a sibling lease holder instead of fetching Codex directly", async () => {
  const paths = await createAuthPaths({ google: { key: "gemini-api-key" } });
  const calls = installFetchMock([]);
  const freshCache = {
    provider: {
      provider: "openai",
      label: "Codex",
      planType: "pro",
      windows: [{ id: "openai-primary", label: "5h", percentUsed: 9, resetText: "45m" }],
      billing: null,
      limitReached: false,
    },
    diagnostics: [],
    refreshedAt: Date.now() + 10,
  };
  let cacheReads = 0;

  const result = await loadLiveUsage(paths, {}, {}, {
    sharedState: {
      fs: {
        readFile: async (filePath) => {
          if (filePath.endsWith("codex-live-usage.lock/owner.json") || filePath.endsWith("owner.json")) {
            return JSON.stringify({ holderId: "other", expiresAt: Date.now() + 60_000 });
          }
          if (filePath.endsWith("codex-live-usage.json")) {
            cacheReads += 1;
            if (cacheReads < 2) {
              throw Object.assign(new Error("missing"), { code: "ENOENT" });
            }
            return JSON.stringify(freshCache);
          }
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
        mkdir: async (filePath) => {
          if (!String(filePath).endsWith("codex-live-usage.lock")) {
            return;
          }
          const error = new Error("exists");
          error.code = "EEXIST";
          throw error;
        },
        writeFile: async () => {},
        rename: async () => {},
        rm: async () => {},
      },
      sleep: async () => {},
    },
  });

  assert.equal(calls.length, 0);
  assert.deepEqual(result.providers, [freshCache.provider, normalizeGeminiUsage()]);
  assert.deepEqual(result.diagnostics, []);
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

test("loadLiveUsage recognizes Gemini from OpenCode google OAuth without an API key", async () => {
  const paths = await createAuthPaths({
    google: {
      type: "oauth",
      access: "google-access-token",
      refresh: "google-refresh-token",
      expires: Date.now() + 60_000,
    },
  });
  const calls = installFetchMock([]);

  const result = await loadLiveUsage(paths);

  assert.equal(calls.length, 0);
  assert.deepEqual(result.providers, [normalizeGeminiUsage()]);
  assert.deepEqual(result.diagnostics, ["Codex not configured"]);
});

test("loadLiveUsage recognizes Gemini from OpenCode config when auth plugin and project id are present", async () => {
  const paths = await createAuthPaths(
    {},
    {},
    {
      plugin: ["opencode-gemini-auth@latest"],
      provider: {
        google: {
          options: {
            projectId: "gen-lang-client-123",
          },
        },
      },
    },
  );
  const calls = installFetchMock([]);

  const result = await loadLiveUsage(paths);

  assert.equal(calls.length, 0);
  assert.deepEqual(result.providers, [normalizeGeminiUsage()]);
  assert.deepEqual(result.diagnostics, ["Codex not configured"]);
});

test("loadLiveUsage prefers Gemini CLI live quota over estimate-only fallback", async () => {
  const paths = await createAuthPaths({ google: { key: "gemini-api-key" } });
  const calls = installFetchMock([]);

  const result = await loadLiveUsage(paths, {}, {}, {
    execFileAsync: async () => ({
      stdout: '{"type":"model_stats","pooledRemaining":80,"pooledLimit":100,"pooledResetTime":"2025-01-01T12:00:00Z"}',
      stderr: "",
    }),
  });

  assert.equal(calls.length, 0);
  assert.equal(result.providers.length, 1);
  assert.equal(result.providers[0].provider, "google");
  assert.equal(result.providers[0].estimateOnly, false);
  assert.equal(result.providers[0].windows[0].percentUsed, 20);
  assert.deepEqual(result.diagnostics, ["Codex not configured"]);
});

test("loadLiveUsage suppresses Gemini missing-key diagnostic when CLI is present but quota is unavailable", async () => {
  const paths = await createAuthPaths();
  const calls = installFetchMock([]);

  const result = await loadLiveUsage(paths, {}, {}, {
    execFileAsync: async () => ({ stdout: "Loaded cached credentials.", stderr: "" }),
  });

  assert.equal(calls.length, 0);
  assert.deepEqual(result.providers, []);
  assert.deepEqual(result.diagnostics, ["Codex not configured"]);
});

test("loadLiveUsage recognizes Gemini from GOOGLE_API_KEY when auth json has no key", async () => {
  const paths = await createAuthPaths({ google: {} });
  const calls = installFetchMock([]);

  const result = await loadLiveUsage(paths, {}, { GOOGLE_API_KEY: "env-google-key" });

  assert.equal(calls.length, 0);
  assert.deepEqual(result.providers, [normalizeGeminiUsage()]);
  assert.deepEqual(result.diagnostics, ["Codex not configured"]);
});

test("loadLiveUsage recognizes Gemini from GEMINI_API_KEY when auth json is missing", async () => {
  const paths = await createAuthPaths();
  const calls = installFetchMock([]);

  const result = await loadLiveUsage(paths, {}, { GEMINI_API_KEY: "env-gemini-key" });

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
