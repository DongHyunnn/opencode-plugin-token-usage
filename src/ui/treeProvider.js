const vscode = require("vscode");
const { formatCurrency, formatNumber, formatRelativeAge } = require("../lib/time");
const { WINDOW_OPTIONS } = require("../constants");
const { selectBillingProviderSummaries } = require("../lib/providerSummary");
const { getCatalogEntry } = require("../lib/providerCatalog");

class DashboardTreeProvider {
  constructor(service) {
    this.service = service;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.service.onDidChange(() => this.refresh());
  }

  refresh() {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    const snapshot = this.service.getSnapshot();
    if (!element) {
      return [
        buildSection("Live Rate Limits", "rate-limit-card"),
        buildSection("Live Billing", "billing-card"),
        buildSection("Local History", "history-card"),
        ...(snapshot.showEstimated7h ? [buildSection("Estimated 7h", "seven-hour-card")] : []),
        buildSection("Diagnostics", "diagnostics-card"),
      ];
    }

    switch (element.contextValue) {
      case "rate-limit-card":
        return buildRateLimitChildren(snapshot);
      case "billing-card":
        return buildBillingChildren(snapshot);
      case "history-card":
        return buildHistoryChildren(snapshot);
      case "seven-hour-card":
        return buildEstimatedSevenHourChildren(snapshot);
      case "diagnostics-card":
        return buildDiagnosticsChildren(snapshot);
      default:
        return [];
    }
  }
}

function buildSection(label, contextValue) {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
  item.contextValue = contextValue;
  return item;
}

function buildLeaf(label, description, tooltip) {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.description = description;
  item.tooltip = tooltip || `${label}${description ? ` - ${description}` : ""}`;
  return item;
}

function buildRateLimitChildren(snapshot) {
  if (!snapshot.live.providers.length) {
    return [buildLeaf("No live rate-limit data", "Refresh to retry")];
  }

  const items = [];
  for (const provider of snapshot.live.providers) {
    if (!provider.windows?.length) continue;
    items.push(buildLeaf(provider.label, provider.limitReached ? "limit reached" : `${provider.windows.length} windows`));
    for (const window of provider.windows) {
      items.push(buildLeaf(`  ${window.label}`, `${window.percentUsed}% used`, `Resets in ${window.resetText}`));
    }
  }

  return items.length ? items : [buildLeaf("No live rate-limit data", "Provider returned no windows")];
}

function buildBillingChildren(snapshot) {
  const liveProviders = snapshot.live?.providers || [];
  const rollingFiveHourHistory = snapshot.rollingFiveHourHistory || null;
  const summaries = selectBillingProviderSummaries(liveProviders, rollingFiveHourHistory);

  if (!summaries.length) {
    return [buildLeaf("Billing unavailable", "No live provider data")];
  }

  return summaries.map((summary) => {
    const catalogEntry = getCatalogEntry(summary.provider);
    const label = catalogEntry ? catalogEntry.label : summary.provider;

    if (summary.kind === "percent") {
      return buildLeaf(label, `${summary.value}% used`, `Live rate-limit window: ${summary.value}% used`);
    } else if (summary.kind === "charge") {
      const sourceLabel = getBillingSourceLabel(summary.source);
      return buildLeaf(label, `${formatCurrency(summary.value)} (${sourceLabel})`, `${sourceLabel}: ${formatCurrency(summary.value)}`);
    }
    return buildLeaf(label, "Unavailable");
  });
}

function getBillingSourceLabel(source) {
  switch (source) {
    case "live":
      return "live";
    case "vendor":
      return "vendor billing";
    case "local":
      return "estimated local 5h";
    default:
      return source;
  }
}

function buildHistoryChildren(snapshot) {
  if (!snapshot.history) {
    return [buildLeaf("History unavailable", "Check database path")];
  }

  const history = snapshot.history;
  const items = [
    buildLeaf("Window", WINDOW_OPTIONS[snapshot.historyWindow]?.label || snapshot.historyWindow),
    buildLeaf("Total tokens", formatNumber(history.totalTokens)),
    buildLeaf("Messages", formatNumber(history.totalMessages)),
    buildLeaf("Cost", formatCurrency(history.totalCost)),
    buildLeaf("Freshness", `${formatRelativeAge(snapshot.refreshedAt)} ago`, "Local history refresh age"),
  ];

  for (const provider of history.providers) {
    items.push(buildLeaf(provider.provider, `${formatNumber(provider.totalTokens)} tok`, `${formatNumber(provider.messageCount)} messages`));
  }
  return items;
}

function buildEstimatedSevenHourChildren(snapshot) {
  if (!snapshot.estimatedSevenHour) {
    return [buildLeaf("Estimated", "History unavailable")];
  }

  return [
    buildLeaf("Estimated", `${formatNumber(snapshot.estimatedSevenHour.totalTokens)} tok`, "Estimated from OpenCode local history"),
    ...snapshot.estimatedSevenHour.providers.map((provider) =>
      buildLeaf(provider.provider, `${formatNumber(provider.totalTokens)} tok`, "Estimated from OpenCode local history"),
    ),
  ];
}

function buildDiagnosticsChildren(snapshot) {
  const items = [];
  items.push(buildLeaf("Last updated", `${formatRelativeAge(snapshot.refreshedAt)} ago`, "freshness-label"));

  if (!snapshot.diagnostics.length) {
    items.push(buildLeaf("Healthy", "No current diagnostics"));
    return items;
  }

  return items.concat(snapshot.diagnostics.map((message) => buildLeaf(message, "warning")));
}

module.exports = {
  DashboardTreeProvider,
  buildEstimatedSevenHourChildren,
  buildBillingChildren,
};
