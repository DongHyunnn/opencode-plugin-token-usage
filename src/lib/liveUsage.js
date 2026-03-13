const {
  ANTHROPIC_USAGE_URL,
  CODEX_USAGE_URL,
  ANTHROPIC_OAUTH_TOKEN_URL,
  OPENAI_OAUTH_TOKEN_URL,
  ANTHROPIC_OAUTH_CLIENT_ID,
  OPENAI_OAUTH_CLIENT_ID,
  ANTHROPIC_RATE_LIMIT_BACKOFF_MS,
} = require("../constants");
const { readJson, writeJson } = require("./json");
const { getProviderPolicy } = require("./providerPolicies");
const { safePct, safeRawPct, formatReset } = require("./time");

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

function getAnthropicAuthDiagnostic(status) {
  if (status === "expired") return "Claude auth expired";
  if (status === "not-configured") return "Claude not configured";
  return null;
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

function hasValidGoogleApiKey(googleAuth) {
  return typeof googleAuth?.key === "string" && googleAuth.key.trim().length > 0;
}

function getGeminiAuthDiagnostic(googleAuth) {
  return hasValidGoogleApiKey(googleAuth) ? null : "Gemini API key missing or invalid";
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

async function loadLiveUsage(paths, previousState = {}) {
  const providers = [];
  const diagnostics = [];
  const now = Date.now();
  const anthropicPolicy = getProviderPolicy("anthropic");
  const nextState = {
    anthropicBackoffUntil: previousState.anthropicBackoffUntil ?? 0,
    anthropicProvider: previousState.anthropicProvider ?? null,
  };

  if (now < nextState.anthropicBackoffUntil) {
    diagnostics.push("Claude rate limited; using backoff window");
    if (anthropicPolicy?.preserveLastKnownLiveProvider && nextState.anthropicProvider) {
      providers.push(nextState.anthropicProvider);
    }
  } else {
    try {
      const anthropicAuth = await ensureAnthropicAuth(paths.openCodeAuthPath);
      const anthropicToken = anthropicAuth?.auth?.anthropic?.access;
      if (anthropicToken) {
        try {
          const data = await fetchAnthropicUsage(anthropicToken);
          const provider = normalizeAnthropicUsage(data);
          providers.push(provider);
          nextState.anthropicProvider = provider;
        } catch (error) {
          const message = getErrorMessage(error);
          if (message.includes("Anthropic 401")) {
            try {
              const refreshed = await ensureAnthropicAuth(paths.openCodeAuthPath, { forceRefresh: true });
              const retryToken = refreshed?.refreshed ? refreshed?.auth?.anthropic?.access : null;
              if (retryToken && retryToken !== anthropicToken) {
                const retryData = await fetchAnthropicUsage(retryToken);
                const provider = normalizeAnthropicUsage(retryData);
                providers.push(provider);
                nextState.anthropicProvider = provider;
              } else {
                diagnostics.push(getAnthropicAuthDiagnostic(refreshed?.status) ?? "Claude auth expired");
              }
            } catch (refreshError) {
              diagnostics.push(getAnthropicAuthFailureDiagnostic(refreshError));
            }
          } else if (message.includes("Anthropic 429")) {
            nextState.anthropicBackoffUntil = now + ANTHROPIC_RATE_LIMIT_BACKOFF_MS;
            diagnostics.push(`Claude rate limited; backing off for ${Math.round(ANTHROPIC_RATE_LIMIT_BACKOFF_MS / 60000)}m`);
            if (anthropicPolicy?.preserveLastKnownLiveProvider && nextState.anthropicProvider) {
              providers.push(nextState.anthropicProvider);
            }
          } else {
            diagnostics.push(`Claude fetch failed: ${message}`);
          }
        }
      }
    } catch (error) {
      diagnostics.push(getAnthropicAuthFailureDiagnostic(error));
    }
  }

  try {
    const openAIAuth = await ensureOpenAIAuth(paths.openCodeAuthPath, paths.codexAuthPath);
    const token = openAIAuth?.token;
    if (token) {
      try {
        const data = await fetchCodexUsage(token);
        providers.push(normalizeCodexUsage(data));
      } catch (error) {
        const message = getErrorMessage(error);
        if (isCodexAuthError(message)) {
          try {
            const refreshed = await ensureOpenAIAuth(paths.openCodeAuthPath, paths.codexAuthPath, { forceRefresh: true });
            if (refreshed?.token) {
              try {
                const retryData = await fetchCodexUsage(refreshed.token);
                providers.push(normalizeCodexUsage(retryData));
              } catch (retryError) {
                const retryMessage = getErrorMessage(retryError);
                if (isCodexAuthError(retryMessage)) {
                  diagnostics.push("Codex auth expired");
                } else {
                  diagnostics.push(`Codex fetch failed: ${retryMessage}`);
                }
              }
            } else {
              diagnostics.push(getCodexAuthDiagnostic(refreshed?.status) ?? "Codex auth expired");
            }
          } catch (refreshError) {
            diagnostics.push(getCodexAuthFailureDiagnostic(refreshError));
          }
        } else {
          diagnostics.push(`Codex fetch failed: ${message}`);
        }
      }
    } else {
      const diagnostic = getCodexAuthDiagnostic(openAIAuth?.status);
      if (diagnostic) diagnostics.push(diagnostic);
    }
  } catch (error) {
    diagnostics.push(getCodexAuthFailureDiagnostic(error));
  }

  const openCodeAuth = (await readJson(paths.openCodeAuthPath)) ?? {};
  const geminiDiagnostic = getGeminiAuthDiagnostic(openCodeAuth?.google);
  if (hasValidGoogleApiKey(openCodeAuth?.google)) {
    providers.push(normalizeGeminiUsage());
  } else if (geminiDiagnostic) {
    diagnostics.push(geminiDiagnostic);
  }

  return {
    providers,
    diagnostics,
    state: nextState,
    refreshedAt: Date.now(),
  };
}

module.exports = {
  normalizeGeminiUsage,
  normalizeAnthropicUsage,
  normalizeCodexUsage,
  loadLiveUsage,
};
