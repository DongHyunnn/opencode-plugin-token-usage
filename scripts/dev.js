#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const workspacePath = path.resolve(__dirname, "..");
const isDryRun = process.argv.includes("--dry-run");
const candidates = ["cursor", "code"];

function findEditorCommand() {
  for (const candidate of candidates) {
    const result = spawnSync("which", [candidate], { encoding: "utf8" });
    if (result.status === 0) {
      return candidate;
    }
  }
  return null;
}

const editorCommand = findEditorCommand();
if (!editorCommand) {
  console.error("No supported editor CLI found. Install Cursor or VS Code and make sure `cursor` or `code` is on PATH.");
  process.exit(1);
}

const editorArgs = [`--extensionDevelopmentPath=${workspacePath}`];

if (isDryRun) {
  console.log(`${editorCommand} ${editorArgs.join(" ")}`);
  process.exit(0);
}

const result = spawnSync(editorCommand, editorArgs, {
  cwd: workspacePath,
  stdio: "inherit",
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

console.error(`Failed to start ${editorCommand}.`);
process.exit(1);
