const vscode = require("vscode");
const { formatRelativeAge, formatCurrency } = require("../lib/time");
const { selectProviderSummaries } = require("../lib/providerSummary");
const { getCatalogEntry } = require("../lib/providerCatalog");
const { getSourceLabel } = require("../lib/providerPolicies");

class StatusBarController {
  constructor(service) {
    this.service = service;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = "opencodeTokenUsage.openDashboard";
    this.item.name = "OTU: OpenCode Token Usage";
    this.service.onDidChange((snapshot) => this.render(snapshot));
  }

  show() {
    this.item.show();
    this.render(this.service.getSnapshot());
  }

  dispose() {
    this.item.dispose();
  }

  render(snapshot) {
    const liveProviders = snapshot.live.providers || [];
    const rollingFiveHourHistory = snapshot.rollingFiveHourHistory;
    const monthlyHistory = snapshot.monthlyHistory;
    const summaries = selectProviderSummaries(liveProviders, rollingFiveHourHistory, monthlyHistory);

    const statusParts = summaries.map((summary) => {
      const catalogEntry = getCatalogEntry(summary.provider);
      if (!catalogEntry) return null;

      const icon = catalogEntry.icon;
      if (summary.kind === "percent") {
        return `${icon} ${summary.value}%`;
      } else if (summary.kind === "charge") {
        return `${icon} ${formatCurrency(summary.value)}`;
      }
      return null;
    }).filter(Boolean);

    if (statusParts.length > 0) {
      this.item.text = statusParts.join("  ");
    } else {
      this.item.text = "$(warning) OC usage unavailable";
    }

    const tooltipLines = summaries.map((summary) => {
      const catalogEntry = getCatalogEntry(summary.provider);
      if (!catalogEntry) return null;

      const sourceLabel = getSourceLabel(summary.provider, summary.source, summary.resetText);
      if (summary.kind === "percent") {
        return `${catalogEntry.label}: ${summary.value}% (${sourceLabel})`;
      } else if (summary.kind === "charge") {
        return `${catalogEntry.label}: ${formatCurrency(summary.value)} (${sourceLabel})`;
      }
      return null;
    }).filter(Boolean);

    tooltipLines.push(`Updated ${formatRelativeAge(snapshot.refreshedAt)} ago`);

    if (snapshot.diagnostics.length) {
      tooltipLines.push("", ...snapshot.diagnostics);
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else {
      this.item.backgroundColor = undefined;
    }

    this.item.tooltip = new vscode.MarkdownString(tooltipLines.join("  \n"));
  }
}

module.exports = {
  StatusBarController,
};
