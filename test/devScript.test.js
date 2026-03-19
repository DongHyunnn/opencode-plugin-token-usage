const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { buildEditorArgs, findEditorCommand, getCommandHelp, getCommandId, getWslVsCodeFallback, hasWslRemoteResolver, isWslRemoteLaunch, resolveEditorCommand, run, supportsExtensionDevelopmentPath } = require("../scripts/dev");

test("getCommandHelp returns null when the editor CLI is missing", () => {
  const output = getCommandHelp("code", () => ({ error: { code: "ENOENT" } }));
  assert.equal(output, null);
});

test("supportsExtensionDevelopmentPath detects supported editor help output", () => {
  const supported = supportsExtensionDevelopmentPath("code", () => ({ stdout: "--version", stderr: "" }));
  const unsupported = supportsExtensionDevelopmentPath("cursor", () => ({ stdout: "--version", stderr: "" }));

  assert.equal(supported, true);
  assert.equal(unsupported, false);
});

test("getCommandId normalizes a bare command and path", () => {
  assert.equal(getCommandId("code"), "code");
  assert.equal(getCommandId("/mnt/c/Users/test/AppData/Local/Programs/Microsoft VS Code/bin/code"), "code");
});

test("findEditorCommand picks the first CLI that supports extension development", () => {
  const calls = [];
  const spawn = (command) => {
    calls.push(command);
    if (command === "cursor") {
      return { stdout: "--version", stderr: "" };
    }

    return { stdout: "Visual Studio Code", stderr: "" };
  };

  const editor = findEditorCommand(spawn);
  assert.equal(editor, "/mnt/c/Users/최동현/AppData/Local/Programs/Microsoft VS Code/bin/code");
  assert.deepEqual(calls, ["cursor", "/mnt/c/Users/최동현/AppData/Local/Programs/Microsoft VS Code/bin/code"]);
});

test("getWslVsCodeFallback finds the standard VS Code install path in WSL", (t) => {
  t.mock.method(fs, "readdirSync", () => [{ isDirectory: () => true, name: "tester" }]);
  t.mock.method(fs, "existsSync", (filePath) => filePath === "/mnt/c/Users/tester/AppData/Local/Programs/Microsoft VS Code/bin/code");

  assert.equal(getWslVsCodeFallback("code"), "/mnt/c/Users/tester/AppData/Local/Programs/Microsoft VS Code/bin/code");
  assert.equal(getWslVsCodeFallback("cursor"), null);
});

test("resolveEditorCommand prefers the WSL VS Code fallback when needed", (t) => {
  t.mock.method(fs, "readdirSync", () => [{ isDirectory: () => true, name: "tester" }]);
  t.mock.method(fs, "existsSync", () => true);

  assert.equal(resolveEditorCommand("code", { WSL_DISTRO_NAME: "Ubuntu" }), "/mnt/c/Users/tester/AppData/Local/Programs/Microsoft VS Code/bin/code");
  assert.equal(resolveEditorCommand("cursor", { WSL_DISTRO_NAME: "Ubuntu" }), "cursor");
});

test("findEditorCommand returns null when cursor is unsupported and code is missing", () => {
  const editor = findEditorCommand((command) => {
    if (command === "cursor") {
      return { stdout: "--version", stderr: "" };
    }

    return { error: { code: "ENOENT" } };
  });

  assert.equal(editor, null);
});

test("findEditorCommand falls back to the standard WSL VS Code path", (t) => {
  t.mock.method(fs, "readdirSync", () => [{ isDirectory: () => true, name: "tester" }]);
  t.mock.method(fs, "existsSync", (filePath) => filePath === "/mnt/c/Users/tester/AppData/Local/Programs/Microsoft VS Code/bin/code");

  const calls = [];
  const editor = findEditorCommand((command) => {
    calls.push(command);
    if (command === "cursor") {
      return { stdout: "--version", stderr: "" };
    }

    if (command === "/mnt/c/Users/tester/AppData/Local/Programs/Microsoft VS Code/bin/code") {
      return { stdout: "Visual Studio Code", stderr: "" };
    }

    return { error: { code: "ENOENT" } };
  }, { WSL_DISTRO_NAME: "Ubuntu" });

  assert.equal(editor, "/mnt/c/Users/tester/AppData/Local/Programs/Microsoft VS Code/bin/code");
  assert.deepEqual(calls, ["cursor", "/mnt/c/Users/tester/AppData/Local/Programs/Microsoft VS Code/bin/code"]);
});

test("buildEditorArgs keeps the legacy dev-host launch outside WSL", () => {
  const args = buildEditorArgs("code", {});
  assert.deepEqual(args, ["--extensionDevelopmentPath=/home/donghyeon/opencode-plugin-token-usage"]);
});

test("isWslRemoteLaunch only applies to VS Code commands under WSL", () => {
  assert.equal(isWslRemoteLaunch("code", { WSL_DISTRO_NAME: "Ubuntu" }), false);
  assert.equal(isWslRemoteLaunch("cursor", { WSL_DISTRO_NAME: "Ubuntu" }), false);
  assert.equal(isWslRemoteLaunch("code", {}), false);
  assert.equal(isWslRemoteLaunch("code", { WSL_REMOTE_DISTRO: "Ubuntu" }), true);
});

test("hasWslRemoteResolver detects the Remote WSL extension", () => {
  const hasResolver = hasWslRemoteResolver("code", () => ({ status: 0, stdout: "ms-vscode-remote.remote-wsl\n", stderr: "" }));
  assert.equal(hasResolver, true);
});

test("hasWslRemoteResolver fails clearly when extension listing fails", () => {
  assert.throws(() => {
    hasWslRemoteResolver("code", () => ({ status: 1, stdout: "", stderr: "list failed" }));
  }, /list failed/);
});

test("buildEditorArgs launches VS Code in a WSL remote window when needed", () => {
  const args = buildEditorArgs("code", { WSL_DISTRO_NAME: "Ubuntu" });
  assert.deepEqual(args, [
    "--new-window",
    "/home/donghyeon/opencode-plugin-token-usage",
    "--extensionDevelopmentPath=/home/donghyeon/opencode-plugin-token-usage",
  ]);
});

test("run prints the resolved dry-run command for the WSL VS Code fallback", () => {
  const output = [];
  const originalLog = console.log;
  console.log = (value) => output.push(value);

  try {
    const exitCode = run(["--dry-run"], (command, args) => {
      if (args[0] === "--help") {
        if (command === "cursor") {
          return { stdout: "--version", stderr: "" };
        }

        return { stdout: "Visual Studio Code", stderr: "" };
      }

      throw new Error(`Unexpected spawn: ${command} ${args.join(" ")}`);
    }, { WSL_DISTRO_NAME: "Ubuntu" });

    assert.equal(exitCode, 0);
    assert.equal(output.length, 1);
    assert.equal(output[0], "/mnt/c/Users/최동현/AppData/Local/Programs/Microsoft VS Code/bin/code --new-window /home/donghyeon/opencode-plugin-token-usage --extensionDevelopmentPath=/home/donghyeon/opencode-plugin-token-usage");
  } finally {
    console.log = originalLog;
  }
});

test("run prints the resolved dry-run command with the WSL VS Code path fallback", (t) => {
  t.mock.method(fs, "readdirSync", () => [{ isDirectory: () => true, name: "tester" }]);
  t.mock.method(fs, "existsSync", (filePath) => filePath === "/mnt/c/Users/tester/AppData/Local/Programs/Microsoft VS Code/bin/code");

  const output = [];
  const originalLog = console.log;
  console.log = (value) => output.push(value);

  try {
    const exitCode = run(["--dry-run"], (command, args) => {
      if (command === "cursor" && args[0] === "--help") {
        return { stdout: "--version", stderr: "" };
      }

      if (command === "/mnt/c/Users/tester/AppData/Local/Programs/Microsoft VS Code/bin/code" && args[0] === "--help") {
        return { stdout: "Visual Studio Code", stderr: "" };
      }

      throw new Error(`Unexpected spawn: ${command} ${args.join(" ")}`);
    }, { WSL_DISTRO_NAME: "Ubuntu" });

    assert.equal(exitCode, 0);
    assert.equal(output.length, 1);
    assert.equal(output[0], "/mnt/c/Users/tester/AppData/Local/Programs/Microsoft VS Code/bin/code --new-window /home/donghyeon/opencode-plugin-token-usage --extensionDevelopmentPath=/home/donghyeon/opencode-plugin-token-usage");
  } finally {
    console.log = originalLog;
  }
});

test("run launches directly from WSL without adding a duplicate remote option", () => {
  const spawns = [];

  const exitCode = run([], (command, args) => {
    spawns.push([command, args]);
    if (args[0] === "--help") {
      if (command === "cursor") {
        return { stdout: "--version", stderr: "" };
      }

      return { stdout: "Visual Studio Code", stderr: "" };
    }

    return { status: 0, stdout: "", stderr: "" };
  }, { WSL_DISTRO_NAME: "Ubuntu" });

  assert.equal(exitCode, 0);
  assert.deepEqual(spawns, [
    ["cursor", ["--help"]],
    ["/mnt/c/Users/최동현/AppData/Local/Programs/Microsoft VS Code/bin/code", ["--help"]],
    [
      "/mnt/c/Users/최동현/AppData/Local/Programs/Microsoft VS Code/bin/code",
      [
        "--new-window",
        "/home/donghyeon/opencode-plugin-token-usage",
        "--extensionDevelopmentPath=/home/donghyeon/opencode-plugin-token-usage",
      ],
    ],
  ]);
});
