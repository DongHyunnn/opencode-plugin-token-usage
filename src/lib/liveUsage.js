const {
  ANTHROPIC_USAGE_URL,
  CODEX_USAGE_URL,
  ANTHROPIC_OAUTH_TOKEN_URL,
  OPENAI_OAUTH_TOKEN_URL,
  ANTHROPIC_OAUTH_CLIENT_ID,
  OPENAI_OAUTH_CLIENT_ID,
  ANTHROPIC_RATE_LIMIT_BACKOFF_MS,
  ANTHROPIC_MIN_POLL_INTERVAL_MS,
  GEMINI_MIN_POLL_INTERVAL_MS,
  GEMINI_CODE_ASSIST_ENDPOINT,
  GOOGLE_OAUTH_TOKEN_URL,
} = require("../constants");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { runAuthenticatedUsage } = require("./authenticatedUsageRunner");
const { readJson, writeJson } = require("./json");
const {
  acquireAnthropicLease,
  acquireOpenAILease,
  isAnthropicCacheFresh,
  isOpenAICacheFresh,
  readAnthropicSharedCache,
  readOpenAISharedCache,
  releaseAnthropicLease,
  releaseOpenAILease,
  waitForAnthropicSharedCache,
  waitForOpenAISharedCache,
  writeAnthropicSharedCache,
  writeOpenAISharedCache,
} = require("./anthropicSharedState");
const { getProviderPolicy } = require("./providerPolicies");
const { safePct, safeRawPct, formatReset } = require("./time");

const execFileAsync = promisify(execFile);
const GEMINI_CLI_COMMAND_CANDIDATES = ["gemini", "/usr/bin/gemini", "/usr/local/bin/gemini"];
const GEMINI_CLI_TIMEOUT_MS = 4000;

let anthropicRefreshInFlight = null;
let openaiRefreshInFlight = null;

function isTokenExpired(expiresMs) {
  if (!expiresMs) return false;
  return Date.now() >= expiresMs;
}

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
}

function getAnthropicAuthStatus(auth, { forceRefresh = false } = {}) {
  const anthropic = auth?.anthropic;
  const hasAccess = Boolean(anthropic?.access);

  if (!forceRefresh && hasAccess && !isTokenExpired(anthropic?.expires)) {
    return "ready";
  }

  if (anthropic?.refresh) {
    return "refreshable";
  }

  if (hasAccess) {
    return "expired";
  }

  return "not-configured";
}

function getAnthropicAuthFailureDiagnostic(error) {
  const message = getErrorMessage(error);
  if (message.startsWith("Anthropic refresh")) {
    return `Claude auth refresh failed: ${message}`;
  }
  return `Claude auth failed: ${message}`;
}

function hasValidOpenAIAccess(openAIAuth) {
  return Boolean(
    openAIAuth?.access && Number.isFinite(openAIAuth?.expires) && !isTokenExpired(openAIAuth.expires),
  );
}

function getOpenAIRefreshTokens(openCodeAuth, codexAuth) {
  return [...new Set([openCodeAuth?.openai?.refresh, codexAuth?.tokens?.refresh_token].filter(Boolean))];
}

function getOpenAIAuthStatus(openCodeAuth, codexAuth, { forceRefresh = false } = {}) {
  const hasOpenCodeAccess = Boolean(openCodeAuth?.openai?.access);
  const hasCodexAccess = Boolean(codexAuth?.tokens?.access_token);

  if (!forceRefresh && hasValidOpenAIAccess(openCodeAuth?.openai)) {
    return "ready";
  }

  if (getOpenAIRefreshTokens(openCodeAuth, codexAuth).length) {
    return "refreshable";
  }

  if (!forceRefresh && hasCodexAccess) {
    return "ready";
  }

  if (hasOpenCodeAccess || hasCodexAccess) {
    return "expired";
  }

  return "not-configured";
}

function getCodexAuthDiagnostic(status) {
  if (status === "not-configured") return "Codex not configured";
  if (status === "expired") return "Codex auth expired";
  return null;
}

function getCodexAuthFailureDiagnostic(error) {
  const message = getErrorMessage(error);
  if (message.startsWith("OpenAI refresh")) {
    return `Codex auth refresh failed: ${message}`;
  }
  return `Codex auth failed: ${message}`;
}

function normalizeGoogleApiKey(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}


function isGeminiOAuthAuth(googleAuth) {
  return googleAuth?.type === "oauth" && Boolean(googleAuth?.refresh);
}

function parseGeminiRefreshParts(refresh) {
  const [refreshToken = "", projectId = "", managedProjectId = ""] = (refresh ?? "").split("|");
  return {
    refreshToken,
    projectId: projectId || undefined,
    managedProjectId: managedProjectId || undefined,
  };
}

function formatGeminiRefreshParts(refreshToken, projectId, managedProjectId) {
  if (!refreshToken) return "";
  if (!projectId && !managedProjectId) return refreshToken;
  return `${refreshToken}|${projectId ?? ""}|${managedProjectId ?? ""}`;
}

function resolveGeminiProjectId(googleAuth) {
  const parts = parseGeminiRefreshParts(googleAuth?.refresh);
  return parts.projectId || parts.managedProjectId || null;
}

function isGeminiAccessTokenExpired(googleAuth) {
  const EXPIRY_BUFFER_MS = 60_000;
  if (!googleAuth?.access) return true;
  if (typeof googleAuth.expires !== "number") return true;
  return googleAuth.expires <= Date.now() + EXPIRY_BUFFER_MS;
}

function resolveGoogleApiKey(googleAuth, env = process.env) {
  return normalizeGoogleApiKey(googleAuth?.key) || normalizeGoogleApiKey(env?.GOOGLE_API_KEY) || normalizeGoogleApiKey(env?.GEMINI_API_KEY);
}

function resolveGeminiOAuthClientCredentials(env = process.env) {
  const clientId = normalizeGoogleApiKey(env?.OTU_GEMINI_OAUTH_CLIENT_ID);
  const clientSecret = normalizeGoogleApiKey(env?.OTU_GEMINI_OAUTH_CLIENT_SECRET);
  return {
    clientId,
    clientSecret,
  };
}

function hasValidGoogleOAuth(googleAuth) {
  if (!googleAuth || googleAuth.type !== "oauth") return false;
  const hasRefreshToken = typeof googleAuth.refresh === "string" && googleAuth.refresh.trim().length > 0;
  const hasAccessToken = typeof googleAuth.access === "string" && googleAuth.access.trim().length > 0;
  if (hasRefreshToken) return true;
  if (!hasAccessToken) return false;
  if (!Number.isFinite(googleAuth.expires)) return true;
  return !isTokenExpired(googleAuth.expires);
}

function hasGeminiPluginConfiguration(openCodeConfig) {
  const projectId = normalizeGoogleProjectId(openCodeConfig?.provider?.google?.options?.projectId);
  if (!projectId) return false;

  const plugins = Array.isArray(openCodeConfig?.plugin) ? openCodeConfig.plugin : [];
  return plugins.some((plugin) => typeof plugin === "string" && plugin.includes("opencode-gemini-auth"));
}

function normalizeGoogleProjectId(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hasGeminiAuth(googleAuth, openCodeConfig, env = process.env) {
  return Boolean(resolveGoogleApiKey(googleAuth, env) || hasValidGoogleOAuth(googleAuth) || hasGeminiPluginConfiguration(openCodeConfig));
}

function getGeminiAuthDiagnostic(googleAuth, openCodeConfig, env = process.env) {
  return hasGeminiAuth(googleAuth, openCodeConfig, env) ? null : "Gemini API key missing or invalid";
}

function normalizeGeminiUsage() {
  return {
    provider: "google",
    label: "Gemini",
    windows: [],
    billing: null,
    limitReached: null,
    estimateOnly: true,
  };
}

function normalizeGeminiCliUsage(quotaSnapshot) {
  const pooledRemaining = Number(quotaSnapshot?.pooledRemaining);
  const pooledLimit = Number(quotaSnapshot?.pooledLimit);
  const pooledResetTime = quotaSnapshot?.pooledResetTime;
  if (!Number.isFinite(pooledRemaining) || !Number.isFinite(pooledLimit) || pooledLimit <= 0) {
    return null;
  }

  return {
    provider: "google",
    label: "Gemini",
    windows: [{
      id: "google-daily",
      label: "1d",
      percentUsed: safeRawPct(((pooledLimit - pooledRemaining) / pooledLimit) * 100),
      resetText: formatReset(pooledResetTime),
    }],
    billing: null,
    limitReached: pooledRemaining <= 0,
    estimateOnly: false,
  };
}

async function loadGeminiCliUsage(env = process.env, dependencies = {}) {
  const exec = dependencies.execFileAsync || execFileAsync;
  let sawGeminiCli = false;

  for (const command of GEMINI_CLI_COMMAND_CANDIDATES) {
    try {
      const { stdout, stderr } = await exec(command, ["-o", "json", "-y", "/stats model"], {
        env,
        timeout: GEMINI_CLI_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      });
      sawGeminiCli = true;
      const quotaSnapshot = parseGeminiCliQuota(stdout || stderr || "");
      if (!quotaSnapshot) {
        return { provider: null, detected: true };
      }

      return { provider: normalizeGeminiCliUsage(quotaSnapshot), detected: true };
    } catch (error) {
      if (isMissingCommandError(error)) {
        continue;
      }

      if (isGeminiCliUnavailableError(error)) {
        sawGeminiCli = true;
        continue;
      }

      return { provider: null, detected: sawGeminiCli };
    }
  }

  return { provider: null, detected: sawGeminiCli };
}

function parseGeminiCliQuota(rawOutput) {
  const jsonCandidate = extractJsonObject(rawOutput);
  if (!jsonCandidate) return null;

  try {
    const parsed = JSON.parse(jsonCandidate);
    return findGeminiQuotaSnapshot(parsed);
  } catch {
    return null;
  }
}

function extractJsonObject(rawOutput) {
  if (typeof rawOutput !== "string") return null;
  const startIndex = rawOutput.indexOf("{");
  const endIndex = rawOutput.lastIndexOf("}");
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return null;
  }

  return rawOutput.slice(startIndex, endIndex + 1);
}

function findGeminiQuotaSnapshot(value) {
  if (!value || typeof value !== "object") return null;

  if (hasGeminiQuotaFields(value)) {
    return value;
  }

  for (const nestedValue of Object.values(value)) {
    const found = findGeminiQuotaSnapshot(nestedValue);
    if (found) return found;
  }

  return null;
}

function hasGeminiQuotaFields(value) {
  return value && typeof value === "object" && (Object.hasOwn(value, "pooledRemaining") || Object.hasOwn(value, "pooledLimit"));
}

function isMissingCommandError(error) {
  return Boolean(error && error.code === "ENOENT");
}

function isGeminiCliUnavailableError(error) {
  if (!error) return false;
  const message = getErrorMessage(error);
  return error.code === "ETIMEDOUT" || message.includes("Please login") || message.includes("not authenticated") || message.includes("not logged in");
}

function formatGeminiModelLabel(modelId) {
  if (!modelId) return "unknown";
  const match = modelId.match(/^gemini-([0-9]+(?:\.[0-9]+)*)-([a-z]+)/i);
  if (match) return `${match[1]} ${match[2].charAt(0).toUpperCase()}${match[2].slice(1).toLowerCase()}`;
  return modelId;
}

function normalizeGeminiOAuthUsage(quota) {
  const buckets = Array.isArray(quota?.buckets) ? quota.buckets : [];
  const windows = buckets
    .filter((bucket) => typeof bucket.remainingFraction === "number")
    .map((bucket) => ({
      id: `google-${bucket.modelId ?? "unknown"}`,
      label: formatGeminiModelLabel(bucket.modelId),
      percentUsed: safeRawPct((1 - bucket.remainingFraction) * 100),
      resetText: formatReset(bucket.resetTime),
      remainingAmount: bucket.remainingAmount,
      tokenType: bucket.tokenType,
    }))
    .sort((a, b) => b.percentUsed - a.percentUsed);

  return {
    provider: "google",
    label: "Gemini",
    windows,
    billing: null,
    limitReached: windows.length > 0 && windows[0].percentUsed >= 100 ? true : false,
    estimateOnly: false,
  };
}

async function refreshGeminiAccessToken(authPath, auth, googleAuth, env = process.env) {
  const parts = parseGeminiRefreshParts(googleAuth.refresh);
  if (!parts.refreshToken) throw new Error("Gemini refresh token missing");

  const { clientId, clientSecret } = resolveGeminiOAuthClientCredentials(env);
  if (!clientId || !clientSecret) {
    throw new Error("Gemini refresh requires local OTU_GEMINI_OAUTH_CLIENT_ID and OTU_GEMINI_OAUTH_CLIENT_SECRET");
  }

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: parts.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Gemini token refresh ${response.status}: ${body.slice(0, 200)}`);
  }

  const json = await response.json();
  const expiresIn = Number(json.expires_in);
  const newRefreshToken = json.refresh_token ?? parts.refreshToken;
  const newRefresh = formatGeminiRefreshParts(newRefreshToken, parts.projectId, parts.managedProjectId);

  const updatedGoogle = {
    ...googleAuth,
    access: json.access_token,
    expires: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : googleAuth.expires,
    refresh: newRefresh,
  };

  const updatedAuth = { ...auth, google: updatedGoogle };
  await writeJson(authPath, updatedAuth);
  return { accessToken: json.access_token, updatedAuth };
}

async function ensureGeminiAccessToken(authPath, auth, googleAuth, env = process.env) {
  if (!isGeminiAccessTokenExpired(googleAuth)) {
    return { accessToken: googleAuth.access };
  }
  return refreshGeminiAccessToken(authPath, auth, googleAuth, env);
}

async function fetchGeminiManagedProjectId(accessToken) {
  const response = await fetch(`${GEMINI_CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Goog-Api-Client": "gl-node/22.17.0",
      "Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
    },
    body: JSON.stringify({
      metadata: {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { projectId: null, reason: `loadCodeAssist ${response.status}: ${body.slice(0, 120)}` };
  }

  const json = await response.json();
  const project = json?.cloudaicompanionProject;
  if (!project) {
    return { projectId: null, reason: "loadCodeAssist returned no cloudaicompanionProject" };
  }
  const id = typeof project === "string" ? project : (project?.id ?? null);
  return { projectId: id, reason: id ? null : "cloudaicompanionProject has no id field" };
}

async function fetchGeminiQuota(accessToken, projectId) {
  const response = await fetch(`${GEMINI_CODE_ASSIST_ENDPOINT}/v1internal:retrieveUserQuota`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Goog-Api-Client": "gl-node/22.17.0",
      "Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
    },
    body: JSON.stringify({ project: projectId }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Gemini quota ${response.status}: ${body.slice(0, 200)}`);
  }

  return response.json();
}

function normalizeAnthropicUsage(data) {
  const windows = [];
  const fiveHour = data?.five_hour ?? data?.fiveHour;
  const sevenDay = data?.seven_day ?? data?.sevenDay;
  if (fiveHour) {
    windows.push({
      id: "anthropic-5h",
      label: "5h",
      percentUsed: safePct(fiveHour.utilization),
      resetText: formatReset(fiveHour.resets_at ?? fiveHour.reset),
    });
  }
  if (sevenDay) {
    windows.push({
      id: "anthropic-7d",
      label: "7d",
      percentUsed: safePct(sevenDay.utilization),
      resetText: formatReset(sevenDay.resets_at ?? sevenDay.reset),
    });
  }

  let billing = null;
  const extra = data?.extra_usage;
  if (extra?.is_enabled) {
    const used = normalizeAnthropicCredits(extra.used_credits);
    const limit = normalizeAnthropicCredits(extra.monthly_limit);
    billing = {
      label: "Extra usage",
      amountUsed: used,
      amountLimit: limit,
      percentUsed: limit > 0 ? safeRawPct((used / limit) * 100) : 0,
      available: true,
    };
  }

  return {
    provider: "anthropic",
    label: "Claude",
    windows,
    billing,
    limitReached: false,
  };
}

function normalizeAnthropicCredits(value) {
  const amount = Number(value) || 0;
  return amount / 100;
}

function formatWindowLabel(seconds) {
  if (!seconds) return "unknown";
  const hours = seconds / 3600;
  if (hours <= 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function normalizeCodexUsage(data) {
  const windows = [];
  const rateLimit = data?.rate_limit;
  if (rateLimit?.primary_window) {
    windows.push({
      id: "openai-primary",
      label: formatWindowLabel(rateLimit.primary_window.limit_window_seconds),
      percentUsed: safeRawPct(rateLimit.primary_window.used_percent),
      resetText: formatReset(rateLimit.primary_window.reset_at),
    });
  }

  if (rateLimit?.secondary_window) {
    windows.push({
      id: "openai-secondary",
      label: formatWindowLabel(rateLimit.secondary_window.limit_window_seconds),
      percentUsed: safeRawPct(rateLimit.secondary_window.used_percent),
      resetText: formatReset(rateLimit.secondary_window.reset_at),
    });
  }

  return {
    provider: "openai",
    label: "Codex",
    planType: data?.plan_type ?? null,
    windows,
    billing: null,
    limitReached: Boolean(rateLimit?.limit_reached),
  };
}

async function refreshAnthropicAuth(authPath, auth) {
  const refreshToken = auth?.anthropic?.refresh;
  if (!refreshToken) throw new Error("Anthropic refresh token missing");

  const response = await fetch(ANTHROPIC_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: ANTHROPIC_OAUTH_CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic refresh ${response.status}: ${body.slice(0, 200)}`);
  }

  const json = await response.json();
  const expiresIn = Number(json.expires_in);
  const updated = {
    ...(auth ?? {}),
    anthropic: {
      ...(auth?.anthropic ?? {}),
      type: "oauth",
      refresh: json.refresh_token ?? refreshToken,
      access: json.access_token,
      expires: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
    },
  };
  await writeJson(authPath, updated);
  return updated;
}

async function ensureAnthropicAuth(authPath, { forceRefresh = false } = {}) {
  const auth = (await readJson(authPath)) ?? {};
  const status = getAnthropicAuthStatus(auth, { forceRefresh });
  if (status === "ready") {
    return { auth, status, refreshed: false };
  }
  if (status !== "refreshable") {
    return { auth, status, refreshed: false };
  }

  if (!anthropicRefreshInFlight) {
    anthropicRefreshInFlight = refreshAnthropicAuth(authPath, auth).finally(() => {
      anthropicRefreshInFlight = null;
    });
  }

  const refreshedAuth = await anthropicRefreshInFlight;
  return { auth: refreshedAuth, status: "ready", refreshed: true };
}

async function refreshOpenAIAuth(openCodeAuthPath, codexAuthPath, openCodeAuth, codexAuth, refreshToken) {
  const response = await fetch(OPENAI_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: OPENAI_OAUTH_CLIENT_ID,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI refresh ${response.status}: ${body.slice(0, 200)}`);
  }

  const json = await response.json();
  const expiresIn = Number(json.expires_in) || 3600;

  let nextOpenCodeAuth = openCodeAuth;
  if (openCodeAuth?.openai) {
    nextOpenCodeAuth = {
      ...(openCodeAuth ?? {}),
      openai: {
        ...(openCodeAuth?.openai ?? {}),
        type: "oauth",
        refresh: json.refresh_token ?? refreshToken,
        access: json.access_token,
        expires: Date.now() + expiresIn * 1000,
      },
    };
    await writeJson(openCodeAuthPath, nextOpenCodeAuth);
  }

  let nextCodexAuth = codexAuth;
  if (codexAuth?.tokens) {
    nextCodexAuth = {
      ...(codexAuth ?? {}),
      tokens: {
        ...(codexAuth?.tokens ?? {}),
        access_token: json.access_token,
        refresh_token: json.refresh_token ?? refreshToken,
        ...(json.id_token ? { id_token: json.id_token } : {}),
      },
      last_refresh: Date.now(),
    };
    await writeJson(codexAuthPath, nextCodexAuth);
  }

  return {
    token: json.access_token,
    openCodeAuth: nextOpenCodeAuth,
    codexAuth: nextCodexAuth,
  };
}

async function ensureOpenAIAuth(openCodeAuthPath, codexAuthPath, { forceRefresh = false } = {}) {
  const openCodeAuth = (await readJson(openCodeAuthPath)) ?? {};
  const codexAuth = (await readJson(codexAuthPath)) ?? {};

  const codexAccess = codexAuth?.tokens?.access_token;
  if (!forceRefresh && hasValidOpenAIAccess(openCodeAuth?.openai)) {
    return { token: openCodeAuth.openai.access, openCodeAuth, codexAuth, status: "ready" };
  }

  const refreshTokens = getOpenAIRefreshTokens(openCodeAuth, codexAuth);
  if (refreshTokens.length) {
    if (!openaiRefreshInFlight) {
      openaiRefreshInFlight = (async () => {
        let lastError = null;
        for (const refreshToken of refreshTokens) {
          try {
            return await refreshOpenAIAuth(openCodeAuthPath, codexAuthPath, openCodeAuth, codexAuth, refreshToken);
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError ?? new Error("OpenAI refresh failed");
      })().finally(() => {
        openaiRefreshInFlight = null;
      });
    }

    return openaiRefreshInFlight;
  }

  if (!forceRefresh && codexAccess) {
    return { token: codexAccess, openCodeAuth, codexAuth, status: "ready" };
  }

  return {
    token: null,
    openCodeAuth,
    codexAuth,
    status: getOpenAIAuthStatus(openCodeAuth, codexAuth, { forceRefresh }),
  };
}

async function fetchAnthropicUsage(token) {
  const response = await fetch(ANTHROPIC_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic ${response.status}: ${body.slice(0, 200)}`);
  }
  return response.json();
}

async function fetchCodexUsage(token) {
  const response = await fetch(CODEX_USAGE_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Codex ${response.status}: ${body.slice(0, 200)}`);
  }
  return response.json();
}

function isCodexAuthError(message) {
  return message.includes("Codex 401") || message.includes("Codex 403");
}

function createAnthropicSharedCache(state, diagnostics, refreshedAt = Date.now()) {
  const anthropicDiagnostics = diagnostics.filter((diagnostic) => diagnostic.startsWith("Claude "));
  return {
    provider: state.anthropicProvider ?? null,
    backoffUntil: state.anthropicBackoffUntil ?? 0,
    diagnostics: anthropicDiagnostics,
    refreshedAt,
  };
}

function createOpenAISharedCache(provider, diagnostics, refreshedAt = Date.now()) {
  const openAIDiagnostics = diagnostics.filter((diagnostic) => diagnostic.startsWith("Codex "));
  return {
    provider: provider ?? null,
    diagnostics: openAIDiagnostics,
    refreshedAt,
  };
}

function applyAnthropicSharedCache(cache, providers, diagnostics, nextState, anthropicPolicy, now = Date.now()) {
  if (!cache) return false;

  if (cache.provider) {
    nextState.anthropicProvider = cache.provider;
  }
  if (Number.isFinite(cache.backoffUntil)) {
    nextState.anthropicBackoffUntil = Math.max(nextState.anthropicBackoffUntil ?? 0, cache.backoffUntil);
  }

  const anthropicDiagnostics = Array.isArray(cache.diagnostics) ? cache.diagnostics : [];
  for (const diagnostic of anthropicDiagnostics) {
    if (!diagnostics.includes(diagnostic)) diagnostics.push(diagnostic);
  }

  if ((now < (nextState.anthropicBackoffUntil ?? 0) || anthropicDiagnostics.length || cache.provider) && cache.provider && anthropicPolicy?.preserveLastKnownLiveProvider) {
    providers.push(cache.provider);
  }

  return Boolean(cache.provider || anthropicDiagnostics.length || now < (nextState.anthropicBackoffUntil ?? 0));
}

function applyOpenAISharedCache(cache, providers, diagnostics) {
  if (!cache) return false;

  const openAIDiagnostics = Array.isArray(cache.diagnostics) ? cache.diagnostics : [];
  for (const diagnostic of openAIDiagnostics) {
    if (!diagnostics.includes(diagnostic)) diagnostics.push(diagnostic);
  }

  if (cache.provider) {
    providers.push(cache.provider);
  }

  return Boolean(cache.provider || openAIDiagnostics.length);
}

async function loadAnthropicUsage(paths, nextState, now, anthropicPolicy, dependencies = {}) {
  const providers = [];
  const diagnostics = [];
  const holderId = `pid-${process.pid}`;
  const refreshIntervalSeconds = Math.max(
    Number(paths.liveRefreshIntervalSeconds) || (ANTHROPIC_MIN_POLL_INTERVAL_MS / 1000),
    ANTHROPIC_MIN_POLL_INTERVAL_MS / 1000,
  );
  const sharedDependencies = dependencies.sharedState || {};
  const cachedSnapshot = await readAnthropicSharedCache(paths.openCodeAuthPath, sharedDependencies);

  if (cachedSnapshot?.provider) {
    nextState.anthropicProvider = cachedSnapshot.provider;
  }
  if (Number.isFinite(cachedSnapshot?.backoffUntil)) {
    nextState.anthropicBackoffUntil = Math.max(nextState.anthropicBackoffUntil ?? 0, cachedSnapshot.backoffUntil);
  }

  if (now < nextState.anthropicBackoffUntil) {
    diagnostics.push("Claude rate limited; using backoff window");
    if (anthropicPolicy?.preserveLastKnownLiveProvider && nextState.anthropicProvider) {
      providers.push(nextState.anthropicProvider);
    }
    await writeAnthropicSharedCache(paths.openCodeAuthPath, createAnthropicSharedCache(nextState, diagnostics, now), sharedDependencies);
    return { providers, diagnostics };
  }

  if (isAnthropicCacheFresh(cachedSnapshot, refreshIntervalSeconds, now) && applyAnthropicSharedCache(cachedSnapshot, providers, diagnostics, nextState, anthropicPolicy, now)) {
    return { providers, diagnostics };
  }

  const hasLease = await acquireAnthropicLease(paths.openCodeAuthPath, holderId, now, sharedDependencies);
  if (!hasLease) {
    const sharedSnapshot = await waitForAnthropicSharedCache(paths.openCodeAuthPath, now, sharedDependencies);
    if (applyAnthropicSharedCache(sharedSnapshot, providers, diagnostics, nextState, anthropicPolicy, now)) {
      return { providers, diagnostics };
    }
    return { providers, diagnostics };
  }

  try {
    const latestCache = await readAnthropicSharedCache(paths.openCodeAuthPath, sharedDependencies);
    if (isAnthropicCacheFresh(latestCache, refreshIntervalSeconds, now) && applyAnthropicSharedCache(latestCache, providers, diagnostics, nextState, anthropicPolicy, now)) {
      return { providers, diagnostics };
    }

    const anthropicResult = await runAuthenticatedUsage({
      ensureAuth: ({ forceRefresh }) => ensureAnthropicAuth(paths.openCodeAuthPath, { forceRefresh }),
      getToken: (authResult) => authResult?.auth?.anthropic?.access ?? null,
      getRetryToken: (authResult, previousToken) => {
        const retryToken = authResult?.refreshed ? authResult?.auth?.anthropic?.access : null;
        return retryToken && retryToken !== previousToken ? retryToken : null;
      },
      fetchUsage: fetchAnthropicUsage,
      normalizeUsage: normalizeAnthropicUsage,
      isAuthError: (message) => message.includes("Anthropic 401"),
      getAuthDiagnostic: (status) => status === "expired" ? "Claude auth expired" : null,
      getAuthFailureDiagnostic: getAnthropicAuthFailureDiagnostic,
      getFetchFailureDiagnostic: (error) => {
        const message = getErrorMessage(error);
        if (message.includes("Anthropic 429")) {
          return `Claude rate limited; backing off for ${Math.round(ANTHROPIC_RATE_LIMIT_BACKOFF_MS / 60000)}m`;
        }
        return `Claude fetch failed: ${message}`;
      },
    });

    if (anthropicResult.provider) {
      providers.push(anthropicResult.provider);
      nextState.anthropicProvider = anthropicResult.provider;
      nextState.anthropicBackoffUntil = 0;
    } else if (anthropicResult.diagnostic) {
      diagnostics.push(anthropicResult.diagnostic);
      if (anthropicResult.diagnostic.includes("Claude rate limited; backing off")) {
        nextState.anthropicBackoffUntil = now + ANTHROPIC_RATE_LIMIT_BACKOFF_MS;
        if (anthropicPolicy?.preserveLastKnownLiveProvider && nextState.anthropicProvider) {
          providers.push(nextState.anthropicProvider);
        }
      }
    }

    await writeAnthropicSharedCache(paths.openCodeAuthPath, createAnthropicSharedCache(nextState, diagnostics), sharedDependencies);
    return { providers, diagnostics };
  } finally {
    await releaseAnthropicLease(paths.openCodeAuthPath, holderId, sharedDependencies);
  }
}

async function loadOpenAIUsage(paths, now, dependencies = {}) {
  const providers = [];
  const diagnostics = [];
  const holderId = `pid-${process.pid}`;
  const refreshIntervalSeconds = Number(paths.liveRefreshIntervalSeconds) || 45;
  const sharedDependencies = dependencies.sharedState || {};
  const cachedSnapshot = await readOpenAISharedCache(paths.openCodeAuthPath, sharedDependencies);

  if (isOpenAICacheFresh(cachedSnapshot, refreshIntervalSeconds, now) && applyOpenAISharedCache(cachedSnapshot, providers, diagnostics)) {
    return { providers, diagnostics };
  }

  const hasLease = await acquireOpenAILease(paths.openCodeAuthPath, holderId, now, sharedDependencies);
  if (!hasLease) {
    const sharedSnapshot = await waitForOpenAISharedCache(paths.openCodeAuthPath, now, sharedDependencies);
    applyOpenAISharedCache(sharedSnapshot, providers, diagnostics);
    return { providers, diagnostics };
  }

  try {
    const latestCache = await readOpenAISharedCache(paths.openCodeAuthPath, sharedDependencies);
    if (isOpenAICacheFresh(latestCache, refreshIntervalSeconds, now) && applyOpenAISharedCache(latestCache, providers, diagnostics)) {
      return { providers, diagnostics };
    }

    const openAIResult = await runAuthenticatedUsage({
      ensureAuth: ({ forceRefresh }) => ensureOpenAIAuth(paths.openCodeAuthPath, paths.codexAuthPath, { forceRefresh }),
      getToken: (authResult) => authResult?.token ?? null,
      fetchUsage: fetchCodexUsage,
      normalizeUsage: normalizeCodexUsage,
      isAuthError: isCodexAuthError,
      getAuthDiagnostic: (status) => getCodexAuthDiagnostic(status) ?? "Codex auth expired",
      getAuthFailureDiagnostic: getCodexAuthFailureDiagnostic,
      getFetchFailureDiagnostic: (error) => `Codex fetch failed: ${getErrorMessage(error)}`,
    });

    if (openAIResult.provider) {
      providers.push(openAIResult.provider);
    } else if (openAIResult.diagnostic) {
      diagnostics.push(openAIResult.diagnostic);
    }

    await writeOpenAISharedCache(paths.openCodeAuthPath, createOpenAISharedCache(openAIResult.provider, diagnostics), sharedDependencies);
    return { providers, diagnostics };
  } finally {
    await releaseOpenAILease(paths.openCodeAuthPath, holderId, sharedDependencies);
  }
}

async function loadLiveUsage(paths, previousState = {}, env = process.env, dependencies = {}) {
  const providers = [];
  const diagnostics = [];
  const now = Date.now();
  const anthropicPolicy = getProviderPolicy("anthropic");
  const nextState = {
    anthropicBackoffUntil: previousState.anthropicBackoffUntil ?? 0,
    anthropicProvider: previousState.anthropicProvider ?? null,
    geminiLastFetchAt: previousState.geminiLastFetchAt ?? 0,
    geminiProvider: previousState.geminiProvider ?? null,
  };

  const anthropic = await loadAnthropicUsage(paths, nextState, now, anthropicPolicy, dependencies);
  providers.push(...anthropic.providers);
  diagnostics.push(...anthropic.diagnostics);

  const openAI = await loadOpenAIUsage(paths, now, dependencies);
  providers.push(...openAI.providers);
  diagnostics.push(...openAI.diagnostics);

  const openCodeAuth = (await readJson(paths.openCodeAuthPath)) ?? {};
  const openCodeConfig = (await readJson(paths.openCodeConfigPath)) ?? {};
  const googleAuth = openCodeAuth?.google;

  if (isGeminiOAuthAuth(googleAuth)) {
    if (now - nextState.geminiLastFetchAt < GEMINI_MIN_POLL_INTERVAL_MS && nextState.geminiProvider) {
      providers.push(nextState.geminiProvider);
    } else {
      let oauthProviderPushed = false;
      try {
        const { accessToken, updatedAuth: refreshedAuth } = await ensureGeminiAccessToken(
          paths.openCodeAuthPath,
          openCodeAuth,
          googleAuth,
          env,
        );
        const currentAuth = refreshedAuth ?? openCodeAuth;
        const currentGoogle = currentAuth?.google ?? googleAuth;

        let projectId = resolveGeminiProjectId(currentGoogle);

        if (!projectId) {
          const { projectId: resolvedId, reason } = await fetchGeminiManagedProjectId(accessToken);
          if (resolvedId) {
            projectId = resolvedId;
            const parts = parseGeminiRefreshParts(currentGoogle.refresh);
            const newRefresh = formatGeminiRefreshParts(parts.refreshToken, resolvedId, undefined);
            const updatedGoogle = { ...currentGoogle, refresh: newRefresh };
            await writeJson(paths.openCodeAuthPath, { ...currentAuth, google: updatedGoogle });
          } else {
            diagnostics.push(`Gemini project not resolved: ${reason ?? "unknown reason"}`);
          }
        }

        if (projectId) {
          const quota = await fetchGeminiQuota(accessToken, projectId);
          if (quota?.buckets?.length) {
            const provider = normalizeGeminiOAuthUsage(quota);
            providers.push(provider);
            nextState.geminiProvider = provider;
            nextState.geminiLastFetchAt = now;
            oauthProviderPushed = true;
          }
        }
      } catch (error) {
        diagnostics.push(`Gemini quota fetch failed: ${getErrorMessage(error)}`);
      }

      if (!oauthProviderPushed) {
        const cliUsage = await loadGeminiCliUsage(env, dependencies);
        if (cliUsage.provider) {
          providers.push(cliUsage.provider);
        } else {
          providers.push(normalizeGeminiUsage());
        }
      }
    }
  } else {
    const cliUsage = await loadGeminiCliUsage(env, dependencies);
    if (cliUsage.provider) {
      providers.push(cliUsage.provider);
    } else if (resolveGoogleApiKey(googleAuth, env) || hasGeminiPluginConfiguration(openCodeConfig)) {
      providers.push(normalizeGeminiUsage());
    } else if (!cliUsage.detected) {
      const geminiDiagnostic = getGeminiAuthDiagnostic(googleAuth, openCodeConfig, env);
      if (geminiDiagnostic) diagnostics.push(geminiDiagnostic);
    }
  }

  return {
    providers,
    diagnostics,
    state: nextState,
    refreshedAt: Date.now(),
  };
}

module.exports = {
  createAnthropicSharedCache,
  createOpenAISharedCache,
  loadGeminiCliUsage,
  loadAnthropicUsage,
  loadOpenAIUsage,
  normalizeGeminiUsage,
  normalizeGeminiCliUsage,
  normalizeGeminiOAuthUsage,
  normalizeAnthropicUsage,
  normalizeCodexUsage,
  parseGeminiCliQuota,
  loadLiveUsage,
};
