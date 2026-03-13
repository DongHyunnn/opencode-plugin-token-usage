const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function main() {
  const editor = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  if (!editor || !["code", "cursor"].includes(editor)) {
    throw new Error("Usage: node scripts/install-vsix.js <code|cursor> [--dry-run]");
  }

  const root = path.resolve(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const vsixName = `${manifest.name}-${manifest.version}.vsix`;
  const vsixPath = path.join(root, vsixName);

  if (!fs.existsSync(vsixPath)) {
    throw new Error(`VSIX not found: ${vsixPath}. Run npm run package:vsix first.`);
  }

  const command = [editor, "--install-extension", vsixPath];
  if (dryRun) {
    console.log(command.join(" "));
    return;
  }

  const result = spawnSync(editor, ["--install-extension", vsixPath], {
    cwd: root,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${editor} --install-extension failed with exit code ${result.status}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
