const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");
const { DEFAULT_PATHS, ROLLING_FIVE_HOUR_WINDOW, DEFAULT_LIVE_REFRESH_INTERVAL_SECONDS } = require("../constants");
const { getAnthropicSharedPaths, getOpenAISharedPaths } = require("./anthropicSharedState");
const { loadHistory } = require("./historyRepository");
const { loadLiveUsage } = require("./liveUsage");

const DEFAULT_DATABASE_PATH_SETTING = "~/.local/share/opencode/opencode.db";

class DashboardService {
  constructor(context) {
    this.context = context;
    this.listeners = new Set();
    this.disposables = [];
    this.liveState = {};
    this.snapshot = {
      historyWindow: "24h",
      history: null,
      monthlyHistory: null,
      rollingFiveHourHistory: null,
      estimatedSevenHour: null,
      live: { providers: [], diagnostics: [], refreshedAt: 0 },
      diagnostics: [],
      refreshedAt: 0,
    };
  }

  getConfiguration() {
    const config = vscode.workspace.getConfiguration("opencodeTokenUsage");
    const configuredDatabasePath = config.get("databasePath");
    return {
      databasePath: resolveDatabasePath(configuredDatabasePath, DEFAULT_PATHS.databasePath),
      openCodeAuthPath: resolveHostPath(config.get("openCodeAuthPath") || DEFAULT_PATHS.openCodeAuthPath),
      openCodeConfigPath: resolveHostPath(config.get("openCodeConfigPath") || DEFAULT_PATHS.openCodeConfigPath),
      codexAuthPath: resolveHostPath(config.get("codexAuthPath") || DEFAULT_PATHS.codexAuthPath),
      refreshIntervalSeconds: Number(config.get("refreshIntervalSeconds") || DEFAULT_LIVE_REFRESH_INTERVAL_SECONDS),
      historyWindow: config.get("historyWindow") || "24h",
      showEstimated7h: Boolean(config.get("showEstimated7h")),
    };
  }

  getSnapshot() {
    return this.snapshot;
  }

  onDidChange(listener) {
    this.listeners.add(listener);
    return new vscode.Disposable(() => {
      this.listeners.delete(listener);
    });
  }

  async start() {
    this.disposeRuntime();
    this.installRuntime();
    await this.refresh("startup");
  }

  dispose() {
    this.disposeRuntime();
  }

  disposeRuntime() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }

  installRuntime() {
    const config = this.getConfiguration();
    const onExternalChange = debounce(() => {
      void this.refresh("file-change");
    }, 800);

    const anthropicSharedPaths = getAnthropicSharedPaths(config.openCodeAuthPath);
    const openAISharedPaths = getOpenAISharedPaths(config.openCodeAuthPath);
    for (const filePath of [config.databasePath, `${config.databasePath}-wal`, config.openCodeAuthPath, config.openCodeConfigPath, config.codexAuthPath, anthropicSharedPaths.cachePath, openAISharedPaths.cachePath]) {
      const watcher = createFsWatcher(filePath, onExternalChange);
      if (watcher) this.disposables.push(watcher);
    }

    const interval = setInterval(() => {
      void this.refresh("interval");
    }, Math.max(10, config.refreshIntervalSeconds) * 1000);
    this.disposables.push(new vscode.Disposable(() => clearInterval(interval)));

    const configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("opencodeTokenUsage")) {
        void this.start();
      }
    });
    this.disposables.push(configSubscription);
  }

  async refresh(reason = "manual") {
    const config = this.getConfiguration();
    const diagnostics = [];
    let history = null;
    let monthlyHistory = null;
    let rollingFiveHourHistory = null;
    let estimatedSevenHour = null;
    let live = { providers: [], diagnostics: [], refreshedAt: 0 };

    try {
      history = await loadHistory(config.databasePath, config.historyWindow);
    } catch (error) {
      diagnostics.push(`History unavailable: ${toMessage(error)}`);
    }

    try {
      rollingFiveHourHistory = await loadHistory(config.databasePath, ROLLING_FIVE_HOUR_WINDOW.key);
    } catch (error) {
      diagnostics.push(`Rolling 5h unavailable: ${toMessage(error)}`);
    }

    try {
      monthlyHistory = await loadHistory(config.databasePath, "30d");
    } catch (error) {
      diagnostics.push(`Monthly history unavailable: ${toMessage(error)}`);
    }

    if (config.showEstimated7h) {
      try {
        estimatedSevenHour = await loadHistory(config.databasePath, "7h");
      } catch (error) {
        diagnostics.push(`Estimated 7h unavailable: ${toMessage(error)}`);
      }
    }

    try {
      const previousAnthropicProvider = this.snapshot.live?.providers?.find((provider) => provider.provider === "anthropic") ?? null;
      live = await loadLiveUsage(
        {
          openCodeAuthPath: config.openCodeAuthPath,
          openCodeConfigPath: config.openCodeConfigPath,
          codexAuthPath: config.codexAuthPath,
          liveRefreshIntervalSeconds: config.refreshIntervalSeconds,
        },
        {
          ...this.liveState,
          anthropicProvider: this.liveState.anthropicProvider ?? previousAnthropicProvider,
        },
      );
      this.liveState = live.state;
    } catch (error) {
      diagnostics.push(`Live usage unavailable: ${toMessage(error)}`);
    }

    this.snapshot = {
      reason,
      historyWindow: config.historyWindow,
      showEstimated7h: config.showEstimated7h,
      history,
      monthlyHistory,
      rollingFiveHourHistory,
      estimatedSevenHour,
      live,
      diagnostics: diagnostics.concat(live.diagnostics || []),
      refreshedAt: Date.now(),
    };

    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}

function createFsWatcher(filePath, onChange) {
  try {
    const directory = path.dirname(filePath);
    const fileName = path.basename(filePath);
    const watcher = fs.watch(directory, (eventType, changedFile) => {
      if (changedFile && changedFile.toString() === fileName) {
        onChange(eventType);
      }
    });
    return new vscode.Disposable(() => watcher.close());
  } catch {
    return null;
  }
}

function debounce(callback, waitMs) {
  let timeout = null;
  return (...args) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), waitMs);
  };
}

function expandHome(value) {
  if (!value || !value.startsWith("~/")) return value;
  return path.join(os.homedir(), value.slice(2));
}

function resolveHostPath(value) {
  const expandedValue = expandHome(value);
  if (!expandedValue) return expandedValue;

  return translateWindowsPathForWsl(expandedValue);
}

function translateWindowsPathForWsl(value) {
  if (!isWslRuntime() || !isWindowsAbsolutePath(value)) {
    return value;
  }

  const normalizedValue = value.replace(/\//g, "\\");
  const driveLetter = normalizedValue[0].toLowerCase();
  const relativePath = normalizedValue
    .slice(2)
    .replace(/\\+/g, "/")
    .replace(/^\/+/, "");

  return path.posix.join("/mnt", driveLetter, relativePath);
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function isWslRuntime() {
  if (process.platform !== "linux") {
    return false;
  }

  return Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP || /microsoft/i.test(os.release()));
}

function resolveDatabasePath(configuredPath, fallbackPath) {
  const resolvedPath = resolveHostPath(configuredPath || fallbackPath);
  const resolvedFallbackPath = resolveHostPath(fallbackPath);
  if (!shouldProbeDefaultDatabasePath(configuredPath, resolvedPath, resolvedFallbackPath)) {
    return resolvedPath;
  }

  return findPreferredDatabasePath(resolvedPath);
}

function shouldProbeDefaultDatabasePath(configuredPath, resolvedPath, fallbackPath) {
  if (!resolvedPath || path.basename(resolvedPath) !== "opencode.db") {
    return false;
  }

  return !configuredPath || configuredPath === DEFAULT_DATABASE_PATH_SETTING || resolvedPath === fallbackPath;
}

function findPreferredDatabasePath(resolvedPath) {
  if (fs.existsSync(resolvedPath)) {
    return resolvedPath;
  }

  const directory = path.dirname(resolvedPath);
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return resolvedPath;
  }

  const candidates = entries
    .filter((entry) => entry.isFile() && /^opencode(?:-[A-Za-z0-9._-]+)?\.db$/.test(entry.name))
    .map((entry) => {
      const candidatePath = path.join(directory, entry.name);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(candidatePath).mtimeMs;
      } catch {}
      return { candidatePath, mtimeMs, exact: entry.name === "opencode.db" };
    })
    .sort((left, right) => {
      if (left.exact !== right.exact) return left.exact ? -1 : 1;
      return right.mtimeMs - left.mtimeMs;
    });

  return candidates[0]?.candidatePath || resolvedPath;
}

function toMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
}

module.exports = {
  DashboardService,
  expandHome,
  resolveDatabasePath,
};
