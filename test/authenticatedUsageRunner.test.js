const test = require("node:test");
const assert = require("node:assert/strict");
const { runAuthenticatedUsage } = require("../src/lib/authenticatedUsageRunner");

test("runAuthenticatedUsage returns a normalized provider on first-pass success", async () => {
  const result = await runAuthenticatedUsage({
    ensureAuth: async () => ({ status: "ready", token: "access-token" }),
    getToken: (authResult) => authResult.token,
    fetchUsage: async (token) => ({ token }),
    normalizeUsage: (data) => ({ provider: "demo", token: data.token }),
    isAuthError: () => false,
    getAuthDiagnostic: (status) => status,
    getAuthFailureDiagnostic: (error) => `auth: ${error.message}`,
    getFetchFailureDiagnostic: (error) => `fetch: ${error.message}`,
  });

  assert.deepEqual(result, {
    provider: { provider: "demo", token: "access-token" },
    diagnostic: null,
    authResult: { status: "ready", token: "access-token" },
    retryAttempted: false,
  });
});

test("runAuthenticatedUsage retries once after an auth error and succeeds", async () => {
  let ensureCalls = 0;
  let fetchCalls = 0;

  const result = await runAuthenticatedUsage({
    ensureAuth: async ({ forceRefresh }) => {
      ensureCalls += 1;
      if (!forceRefresh) return { status: "ready", token: "stale-token", refreshed: false };
      return { status: "ready", token: "fresh-token", refreshed: true };
    },
    getToken: (authResult) => authResult.token,
    getRetryToken: (authResult, previousToken) => authResult.token !== previousToken ? authResult.token : null,
    fetchUsage: async (token) => {
      fetchCalls += 1;
      if (token === "stale-token") throw new Error("Demo 401");
      return { token };
    },
    normalizeUsage: (data) => ({ provider: "demo", token: data.token }),
    isAuthError: (message) => message.includes("401"),
    getAuthDiagnostic: (status) => status,
    getAuthFailureDiagnostic: (error) => `auth: ${error.message}`,
    getFetchFailureDiagnostic: (error) => `fetch: ${error.message}`,
  });

  assert.equal(ensureCalls, 2);
  assert.equal(fetchCalls, 2);
  assert.equal(result.provider.token, "fresh-token");
  assert.equal(result.retryAttempted, true);
});

test("runAuthenticatedUsage returns auth diagnostic when retry cannot produce a new token", async () => {
  const result = await runAuthenticatedUsage({
    ensureAuth: async ({ forceRefresh }) => ({ status: forceRefresh ? "expired" : "ready", token: "same-token", refreshed: forceRefresh }),
    getToken: (authResult) => authResult.token,
    getRetryToken: (authResult, previousToken) => authResult.token !== previousToken ? authResult.token : null,
    fetchUsage: async () => {
      throw new Error("Demo 401");
    },
    normalizeUsage: (data) => data,
    isAuthError: (message) => message.includes("401"),
    getAuthDiagnostic: (status) => `diag:${status}`,
    getAuthFailureDiagnostic: (error) => `auth:${error.message}`,
    getFetchFailureDiagnostic: (error) => `fetch:${error.message}`,
  });

  assert.equal(result.provider, null);
  assert.equal(result.diagnostic, "diag:expired");
  assert.equal(result.retryAttempted, true);
});

test("runAuthenticatedUsage returns fetch diagnostic for non-auth errors without refresh", async () => {
  let ensureCalls = 0;

  const result = await runAuthenticatedUsage({
    ensureAuth: async () => {
      ensureCalls += 1;
      return { status: "ready", token: "access-token" };
    },
    getToken: (authResult) => authResult.token,
    fetchUsage: async () => {
      throw new Error("Demo 500");
    },
    normalizeUsage: (data) => data,
    isAuthError: (message) => message.includes("401"),
    getAuthDiagnostic: (status) => `diag:${status}`,
    getAuthFailureDiagnostic: (error) => `auth:${error.message}`,
    getFetchFailureDiagnostic: (error) => `fetch:${error.message}`,
  });

  assert.equal(ensureCalls, 1);
  assert.equal(result.provider, null);
  assert.equal(result.diagnostic, "fetch:Demo 500");
  assert.equal(result.retryAttempted, false);
});
