const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const { promisify } = require("node:util");
const { summarizeHistoryRows, getWindow } = require("./history");

const execFileAsync = promisify(execFile);
const SQLITE_COMMAND_CANDIDATES = ["sqlite3", "/usr/bin/sqlite3", "/bin/sqlite3"];
const PYTHON_COMMAND_CANDIDATES = ["python3", "/usr/bin/python3", "python"];
const PYTHON_SQLITE_SCRIPT = [
  "import sqlite3, sys",
  "connection = sqlite3.connect(sys.argv[1])",
  "cursor = connection.execute(sys.argv[2])",
  "for row in cursor:",
  "    print('|'.join('' if value is None else str(value) for value in row))",
  "connection.close()",
].join("\n");

function buildHistoryQuery(startAt) {
  return `
    SELECT
      COALESCE(json_extract(data, '$.providerID'), 'unknown') AS provider,
      COUNT(*) AS messageCount,
      SUM(COALESCE(json_extract(data, '$.tokens.total'), 0) - COALESCE(json_extract(data, '$.tokens.cache.read'), 0)) AS totalTokens,
      SUM(COALESCE(json_extract(data, '$.tokens.input'), 0)) AS inputTokens,
      SUM(COALESCE(json_extract(data, '$.tokens.output'), 0)) AS outputTokens,
      SUM(COALESCE(json_extract(data, '$.tokens.reasoning'), 0)) AS reasoningTokens,
      SUM(COALESCE(json_extract(data, '$.cost'), 0)) AS totalCost,
      MAX(COALESCE(json_extract(data, '$.time.completed'), json_extract(data, '$.time.created'))) AS lastAt
    FROM message
    WHERE json_extract(data, '$.tokens.total') IS NOT NULL
      AND COALESCE(json_extract(data, '$.time.completed'), json_extract(data, '$.time.created')) >= ${Math.floor(startAt)}
    GROUP BY provider
    ORDER BY totalTokens DESC;
  `;
}

function parseRows(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [provider, messageCount, totalTokens, inputTokens, outputTokens, reasoningTokens, totalCost, lastAt] = line.split("|");
      return {
        provider,
        messageCount,
        totalTokens,
        inputTokens,
        outputTokens,
        reasoningTokens,
        totalCost,
        lastAt,
      };
    });
}

async function loadHistory(databasePath, windowKey, now = Date.now(), dependencies = {}) {
  const window = getWindow(windowKey);
  const sql = buildHistoryQuery(now - window.ms);
  const { stdout } = await executeHistoryQuery(databasePath, sql, dependencies);
  return summarizeHistoryRows(parseRows(stdout), window.key, now);
}

async function executeHistoryQuery(databasePath, sql, dependencies = {}) {
  const exec = dependencies.execFileAsync || execFileAsync;
  const fsApi = dependencies.fs || fs;

  await fsApi.access(databasePath);

  for (const command of SQLITE_COMMAND_CANDIDATES) {
    try {
      return await exec(command, ["-separator", "|", databasePath, sql]);
    } catch (error) {
      if (!isMissingCommandError(error)) throw error;
    }
  }

  for (const command of PYTHON_COMMAND_CANDIDATES) {
    try {
      return await exec(command, ["-c", PYTHON_SQLITE_SCRIPT, databasePath, sql]);
    } catch (error) {
      if (!isMissingCommandError(error)) throw error;
    }
  }

  throw new Error("sqlite3 not found; install sqlite3 or python3 with sqlite support");
}

function isMissingCommandError(error) {
  return Boolean(error && error.code === "ENOENT");
}

module.exports = {
  buildHistoryQuery,
  executeHistoryQuery,
  parseRows,
  loadHistory,
};
