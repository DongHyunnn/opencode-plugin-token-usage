const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;
const dashboardServicePath = require.resolve("../src/lib/dashboardService");

function createVscodeMock(overrides = {}) {
  const values = {
    databasePath: "/tmp/opencode.db",
    openCodeAuthPath: "/tmp/auth.json",
    codexAuthPath: "/tmp/codex.json",
    refreshIntervalSeconds: 30,
    historyWindow: "24h",
    showEstimated7h: false,
    ...overrides,
  };

  class Disposable {
    constructor(callback) {
      this.callback = callback;
    }

    dispose() {
      if (this.callback) this.callback();
    }
  }

  return {
    workspace: {
      getConfiguration() {
        return {
          get(key) {
            return values[key];
          },
        };
      },
      onDidChangeConfiguration() {
        return new Disposable(() => {});
      },
    },
    Disposable,
  };
}

function loadDashboardService({ configOverrides, loadHistoryImpl, loadLiveUsageImpl }) {
  delete require.cache[dashboardServicePath];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") {
      return createVscodeMock(configOverrides);
    }

    if (parent && parent.filename === dashboardServicePath && request === "./historyRepository") {
      return { loadHistory: loadHistoryImpl };
    }

    if (parent && parent.filename === dashboardServicePath && request === "./liveUsage") {
      return { loadLiveUsage: loadLiveUsageImpl };
    }

    return originalLoad(request, parent, isMain);
  };

  return require("../src/lib/dashboardService");
}

test.after(() => {
  Module._load = originalLoad;
  delete require.cache[dashboardServicePath];
});

test("refresh always loads a dedicated rolling 5h history snapshot", async () => {
  const historyCalls = [];
  const selectedWindowHistory = { window: { key: "24h" }, totalTokens: 2400 };
  const rollingFiveHourHistory = { window: { key: "5h" }, totalTokens: 500 };
  const monthlyHistory = { window: { key: "30d" }, totalTokens: 9000, totalCost: 21.5 };
  const liveSnapshot = { providers: [{ provider: "openai" }], diagnostics: [], refreshedAt: 123, state: { ok: true } };

  const { DashboardService } = loadDashboardService({
    loadHistoryImpl: async (databasePath, windowKey) => {
      historyCalls.push([databasePath, windowKey]);
      if (windowKey === "24h") return selectedWindowHistory;
      if (windowKey === "5h") return rollingFiveHourHistory;
      if (windowKey === "30d") return monthlyHistory;
      throw new Error(`Unexpected window ${windowKey}`);
    },
    loadLiveUsageImpl: async () => liveSnapshot,
  });

  const service = new DashboardService({ subscriptions: [] });
  await service.refresh("manual");

  const snapshot = service.getSnapshot();
  assert.deepEqual(historyCalls, [
    ["/tmp/opencode.db", "24h"],
    ["/tmp/opencode.db", "5h"],
    ["/tmp/opencode.db", "30d"],
  ]);
  assert.equal(snapshot.historyWindow, "24h");
  assert.equal(snapshot.showEstimated7h, false);
  assert.equal(snapshot.history, selectedWindowHistory);
  assert.equal(snapshot.monthlyHistory, monthlyHistory);
  assert.ok(Object.hasOwn(snapshot, "rollingFiveHourHistory"));
  assert.equal(snapshot.rollingFiveHourHistory, rollingFiveHourHistory);
  assert.equal(snapshot.estimatedSevenHour, null);
  assert.equal(snapshot.live, liveSnapshot);
});

test("refresh keeps estimated 7h behavior alongside rolling 5h history", async () => {
  const historyCalls = [];
  const selectedWindowHistory = { window: { key: "24h" }, totalTokens: 2400 };
  const estimatedSevenHour = { window: { key: "7h" }, totalTokens: 700 };
  const rollingFiveHourHistory = { window: { key: "5h" }, totalTokens: 500 };
  const monthlyHistory = { window: { key: "30d" }, totalTokens: 9000, totalCost: 18.25 };

  const { DashboardService } = loadDashboardService({
    configOverrides: { showEstimated7h: true },
    loadHistoryImpl: async (databasePath, windowKey) => {
      historyCalls.push([databasePath, windowKey]);
      if (windowKey === "24h") return selectedWindowHistory;
      if (windowKey === "7h") return estimatedSevenHour;
      if (windowKey === "5h") return rollingFiveHourHistory;
      if (windowKey === "30d") return monthlyHistory;
      throw new Error(`Unexpected window ${windowKey}`);
    },
    loadLiveUsageImpl: async () => ({ providers: [], diagnostics: [], refreshedAt: 123, state: {} }),
  });

  const service = new DashboardService({ subscriptions: [] });
  await service.refresh("manual");

  const snapshot = service.getSnapshot();
  assert.deepEqual(historyCalls, [
    ["/tmp/opencode.db", "24h"],
    ["/tmp/opencode.db", "5h"],
    ["/tmp/opencode.db", "30d"],
    ["/tmp/opencode.db", "7h"],
  ]);
  assert.equal(snapshot.history, selectedWindowHistory);
  assert.equal(snapshot.monthlyHistory, monthlyHistory);
  assert.equal(snapshot.rollingFiveHourHistory, rollingFiveHourHistory);
  assert.equal(snapshot.estimatedSevenHour, estimatedSevenHour);
});

test("refresh seeds Anthropic live fallback from the previous snapshot during backoff", async () => {
  let previousStateArg = null;
  const previousAnthropicProvider = {
    provider: "anthropic",
    label: "Claude",
    windows: [{ id: "anthropic-5h", label: "5h", percentUsed: 19, resetText: "1h 30m" }],
    billing: null,
    limitReached: false,
  };

  const { DashboardService } = loadDashboardService({
    loadHistoryImpl: async () => ({ window: { key: "24h" }, totalTokens: 10 }),
    loadLiveUsageImpl: async (_paths, previousState) => {
      previousStateArg = previousState;
      return { providers: [previousState.anthropicProvider], diagnostics: [], refreshedAt: 123, state: previousState };
    },
  });

  const service = new DashboardService({ subscriptions: [] });
  service.snapshot = {
    ...service.getSnapshot(),
    live: { providers: [previousAnthropicProvider], diagnostics: [], refreshedAt: 111 },
  };

  await service.refresh("manual");

  assert.equal(previousStateArg.anthropicProvider, previousAnthropicProvider);
  assert.equal(service.getSnapshot().live.providers[0], previousAnthropicProvider);
});
