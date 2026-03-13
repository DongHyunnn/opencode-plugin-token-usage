const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const TRACKER_PLUGIN_FILENAME = "opencode-token-usage-tracker.js";
const TRACKER_PLUGIN_ASSET_PATH = path.join("resources", TRACKER_PLUGIN_FILENAME);

function getGlobalPluginInstallPath(homeDirectory = os.homedir()) {
  return path.join(homeDirectory, ".config", "opencode", "plugins", TRACKER_PLUGIN_FILENAME);
}

async function installTrackingPlugin(context, homeDirectory = os.homedir()) {
  const targetPath = getGlobalPluginInstallPath(homeDirectory);
  const sourcePath = path.join(context.extensionPath, TRACKER_PLUGIN_ASSET_PATH);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  let existed = true;
  try {
    await fs.access(targetPath);
  } catch {
    existed = false;
  }

  await fs.copyFile(sourcePath, targetPath);
  return { targetPath, existed };
}

module.exports = {
  TRACKER_PLUGIN_ASSET_PATH,
  TRACKER_PLUGIN_FILENAME,
  getGlobalPluginInstallPath,
  installTrackingPlugin,
};
