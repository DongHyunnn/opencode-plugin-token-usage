const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { getGlobalPluginInstallPath, installTrackingPlugin } = require("../src/lib/pluginInstall");

test("getGlobalPluginInstallPath uses the documented global OpenCode plugins directory", () => {
  const target = getGlobalPluginInstallPath("/tmp/home");
  assert.equal(target, "/tmp/home/.config/opencode/plugins/opencode-token-usage-tracker.js");
});

test("installTrackingPlugin copies the bundled tracker plugin into the global plugins directory", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "token-usage-plugin-"));
  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const extensionPath = path.join(tempDir, "extension");
  const resourcesPath = path.join(extensionPath, "resources");
  await fs.mkdir(resourcesPath, { recursive: true });
  const sourcePath = path.join(resourcesPath, "opencode-token-usage-tracker.js");
  await fs.writeFile(sourcePath, "exports.TokenUsageTrackerPlugin = async () => ({});\n", "utf8");

  const result = await installTrackingPlugin({ extensionPath }, path.join(tempDir, "home"));
  const copied = await fs.readFile(result.targetPath, "utf8");

  assert.equal(result.existed, false);
  assert.equal(copied, "exports.TokenUsageTrackerPlugin = async () => ({});\n");
});
