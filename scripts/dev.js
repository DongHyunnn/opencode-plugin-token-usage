#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const workspacePath = path.resolve(__dirname, "..");
const candidates = ["cursor", "code"];
const documentedVsCodeCommands = new Set(["code", "code-insiders"]);
const wslResolverExtensionId = "ms-vscode-remote.remote-wsl";

function getCommandId(command) {
  return path.basename(command).replace(/\.cmd$/i, "");
}

function getWslVsCodeFallback(command) {
  const commandId = getCommandId(command);
  if (!documentedVsCodeCommands.has(commandId)) {
    return null;
  }

  const userRoot = "/mnt/c/Users";
  try {
    const userDirectories = fs.readdirSync(userRoot, { withFileTypes: true });
    for (const entry of userDirectories) {
      if (!entry.isDirectory()) continue;

      const fallbackPath = path.join(userRoot, entry.name, "AppData", "Local", "Programs", "Microsoft VS Code", "bin", commandId);
      if (fs.existsSync(fallbackPath)) {
        return fallbackPath;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function resolveEditorCommand(command, env = process.env) {
  if (!env.WSL_DISTRO_NAME) {
    return command;
  }

  return getWslVsCodeFallback(command) || command;
}

function getCommandHelp(command, spawn = spawnSync) {
  const result = spawn(command, ["--help"], { encoding: "utf8" });
  if (result.error && result.error.code === "ENOENT") {
    return null;
  }

  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function supportsExtensionDevelopmentPath(command, spawn = spawnSync, env = process.env) {
  const resolvedCommand = resolveEditorCommand(command, env);
  const output = getCommandHelp(resolvedCommand, spawn);
  if (!output) return false;
  if (documentedVsCodeCommands.has(getCommandId(resolvedCommand))) return true;
  return output.includes("extensionDevelopmentPath");
}

function findEditorCommand(spawn = spawnSync, env = process.env) {
  for (const candidate of candidates) {
    const resolvedCommand = resolveEditorCommand(candidate, env);
    if (supportsExtensionDevelopmentPath(resolvedCommand, spawn, env)) {
      return resolvedCommand;
    }
  }
  return null;
}

function isWslRemoteLaunch(command, env = process.env) {
  return Boolean(env.WSL_REMOTE_DISTRO && documentedVsCodeCommands.has(getCommandId(command)));
}

function hasWslRemoteResolver(command, spawn = spawnSync) {
  const result = spawn(command, ["--list-extensions"], { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || `Failed to list extensions from ${command}.`).trim());
  }

  return `${result.stdout || ""}\n${result.stderr || ""}`.includes(wslResolverExtensionId);
}

function buildEditorArgs(command, env = process.env) {
  if (env.WSL_DISTRO_NAME) {
    return [
      "--new-window",
      workspacePath,
      `--extensionDevelopmentPath=${workspacePath}`,
    ];
  }

  return [`--extensionDevelopmentPath=${workspacePath}`];
}

function run(argv = process.argv.slice(2), spawn = spawnSync, env = process.env) {
  const isDryRun = argv.includes("--dry-run");
  const editorCommand = findEditorCommand(spawn, env);
  if (!editorCommand) {
    console.error("No supported editor CLI found for extension development. Install VS Code with `code` on PATH, or use an editor CLI that supports `--extensionDevelopmentPath`.");
    console.error("If Cursor is installed but its CLI does not support extension development flags, open this folder in the editor and run the launch configuration manually.");
    return 1;
  }

  let editorArgs;
  try {
    if (!isDryRun && isWslRemoteLaunch(editorCommand, env) && !hasWslRemoteResolver(editorCommand, spawn)) {
      console.error(`VS Code needs the '${wslResolverExtensionId}' extension installed to launch this repo from WSL.`);
      console.error(`Install it with '${editorCommand} --install-extension ${wslResolverExtensionId}' and restart VS Code, then run npm run dev again.`);
      return 1;
    }

    editorArgs = buildEditorArgs(editorCommand, env);
  } catch (error) {
    console.error(`Failed to prepare the extension development launch: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  if (isDryRun) {
    console.log(`${editorCommand} ${editorArgs.join(" ")}`);
    return 0;
  }

  const result = spawn(editorCommand, editorArgs, {
    cwd: workspacePath,
    stdio: "inherit",
  });

  if (typeof result.status === "number") {
    return result.status;
  }

  console.error(`Failed to start ${editorCommand}.`);
  return 1;
}

if (require.main === module) {
  process.exit(run());
}

module.exports = {
  buildEditorArgs,
  findEditorCommand,
  getCommandHelp,
  getCommandId,
  getWslVsCodeFallback,
  hasWslRemoteResolver,
  isWslRemoteLaunch,
  resolveEditorCommand,
  run,
  supportsExtensionDevelopmentPath,
};
