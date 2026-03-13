const vscode = require("vscode");
const { DashboardService } = require("./lib/dashboardService");
const { DashboardTreeProvider } = require("./ui/treeProvider");
const { StatusBarController } = require("./ui/statusBar");
const { WINDOW_OPTIONS } = require("./constants");
const { installTrackingPlugin } = require("./lib/pluginInstall");

async function activate(context) {
  const service = new DashboardService(context);
  const treeProvider = new DashboardTreeProvider(service);
  const treeView = vscode.window.createTreeView("opencodeTokenUsage.dashboard", {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });
  const statusBar = new StatusBarController(service);

  context.subscriptions.push(service, treeView, statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand("opencodeTokenUsage.refresh", async () => {
      await service.refresh("command");
    }),
    vscode.commands.registerCommand("opencodeTokenUsage.selectWindow", async () => {
      const picks = Object.values(WINDOW_OPTIONS).map((window) => ({
        label: window.key,
        description: window.label,
      }));
      const selected = await vscode.window.showQuickPick(picks, {
        title: "Select OpenCode history window",
        placeHolder: "Choose the local history window shown in the dashboard",
      });
      if (!selected) return;
      await vscode.workspace
        .getConfiguration("opencodeTokenUsage")
        .update("historyWindow", selected.label, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand("opencodeTokenUsage.openDashboard", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.opencodeTokenUsage");
      if (treeView.visible) {
        await service.refresh("open-dashboard");
      }
    }),
    vscode.commands.registerCommand("opencodeTokenUsage.installTrackingPlugin", async () => {
      try {
        const result = await installTrackingPlugin(context);
        const detail = result.existed ? "Tracking plugin already installed. Restart OpenCode to reload it." : "Tracking plugin installed. Restart OpenCode to load it.";
        await vscode.window.showInformationMessage(detail);
      } catch (error) {
        await vscode.window.showErrorMessage(`Failed to install tracking plugin: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );

  statusBar.show();
  await service.start();
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
