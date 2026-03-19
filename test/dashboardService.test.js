const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const originalLoad = Module._load;
const dashboardServicePath = require.resolve("../src/lib/dashboardService");

function createVscodeMock(overrides = {}) {
  const values = {
    databasePath: "/tmp/opencode.db",
    openCodeAuthPath: "/tmp/auth.json",
    openCodeConfigPath: "/tmp/opencode.json",
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

test("resolveDatabasePath falls back to a channel-specific OpenCode database when the default filename is missing", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dashboard-service-db-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const storageDir = path.join(tempDir, ".local", "share", "opencode");
  await fs.mkdir(storageDir, { recursive: true });
  const channelDbPath = path.join(storageDir, "opencode-dev.db");
  await fs.writeFile(channelDbPath, "", "utf8");

  const { resolveDatabasePath } = loadDashboardService({
    loadHistoryImpl: async () => null,
    loadLiveUsageImpl: async () => ({ providers: [], diagnostics: [], refreshedAt: 0, state: {} }),
  });

  const resolved = resolveDatabasePath(undefined, path.join(storageDir, "opencode.db"));
  assert.equal(resolved, channelDbPath);
});

test("resolveDatabasePath preserves explicit custom paths even when a channel database exists nearby", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dashboard-service-db-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const storageDir = path.join(tempDir, ".local", "share", "opencode");
  await fs.mkdir(storageDir, { recursive: true });
  await fs.writeFile(path.join(storageDir, "opencode-beta.db"), "", "utf8");

  const explicitPath = path.join(tempDir, "custom", "opencode.db");
  const { resolveDatabasePath } = loadDashboardService({
    loadHistoryImpl: async () => null,
    loadLiveUsageImpl: async () => ({ providers: [], diagnostics: [], refreshedAt: 0, state: {} }),
  });

  const resolved = resolveDatabasePath(explicitPath, path.join(storageDir, "opencode.db"));
  assert.equal(resolved, explicitPath);
});

test("resolveDatabasePath translates explicit Windows paths when running inside WSL", () => {
  const previousDistro = process.env.WSL_DISTRO_NAME;
  process.env.WSL_DISTRO_NAME = "Ubuntu";

  try {
    const { resolveDatabasePath } = loadDashboardService({
      loadHistoryImpl: async () => null,
      loadLiveUsageImpl: async () => ({ providers: [], diagnostics: [], refreshedAt: 0, state: {} }),
    });

    const resolved = resolveDatabasePath(
      "C:\\Users\\Alice\\.local\\share\\opencode\\opencode.db",
      "/home/alice/.local/share/opencode/opencode.db",
    );
    assert.equal(resolved, "/mnt/c/Users/Alice/.local/share/opencode/opencode.db");
  } finally {
    if (previousDistro === undefined) {
      delete process.env.WSL_DISTRO_NAME;
    } else {
      process.env.WSL_DISTRO_NAME = previousDistro;
    }
  }
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

test("refresh translates Windows-style configured paths before loading history and auth in WSL", async () => {
  const previousDistro = process.env.WSL_DISTRO_NAME;
  process.env.WSL_DISTRO_NAME = "Ubuntu";
  const historyCalls = [];
  const liveUsageCalls = [];

  try {
    const { DashboardService } = loadDashboardService({
      configOverrides: {
        databasePath: "C:\\Users\\Alice\\.local\\share\\opencode\\opencode.db",
        openCodeAuthPath: "C:\\Users\\Alice\\.local\\share\\opencode\\auth.json",
        openCodeConfigPath: "C:\\Users\\Alice\\.config\\opencode\\opencode.json",
        codexAuthPath: "C:\\Users\\Alice\\.codex\\auth.json",
      },
      loadHistoryImpl: async (databasePath, windowKey) => {
        historyCalls.push([databasePath, windowKey]);
        return { window: { key: windowKey }, totalTokens: 10 };
      },
      loadLiveUsageImpl: async (paths) => {
        liveUsageCalls.push(paths);
        return { providers: [], diagnostics: [], refreshedAt: 123, state: {} };
      },
    });

    const service = new DashboardService({ subscriptions: [] });
    await service.refresh("manual");

    assert.deepEqual(historyCalls, [
      ["/mnt/c/Users/Alice/.local/share/opencode/opencode.db", "24h"],
      ["/mnt/c/Users/Alice/.local/share/opencode/opencode.db", "5h"],
      ["/mnt/c/Users/Alice/.local/share/opencode/opencode.db", "30d"],
    ]);
    assert.deepEqual(liveUsageCalls, [
      {
        openCodeAuthPath: "/mnt/c/Users/Alice/.local/share/opencode/auth.json",
        openCodeConfigPath: "/mnt/c/Users/Alice/.config/opencode/opencode.json",
        codexAuthPath: "/mnt/c/Users/Alice/.codex/auth.json",
        liveRefreshIntervalSeconds: 30,
      },
    ]);
  } finally {
    if (previousDistro === undefined) {
      delete process.env.WSL_DISTRO_NAME;
    } else {
      process.env.WSL_DISTRO_NAME = previousDistro;
    }
  }
});
