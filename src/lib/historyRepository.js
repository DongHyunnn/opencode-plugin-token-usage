const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const { promisify } = require("node:util");
const { summarizeHistoryRows, getWindow } = require("./history");

const execFileAsync = promisify(execFile);

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

async function loadHistory(databasePath, windowKey, now = Date.now()) {
  await fs.access(databasePath);
  const window = getWindow(windowKey);
  const sql = buildHistoryQuery(now - window.ms);
  const { stdout } = await execFileAsync("sqlite3", ["-separator", "|", databasePath, sql]);
  return summarizeHistoryRows(parseRows(stdout), window.key, now);
}

module.exports = {
  buildHistoryQuery,
  parseRows,
  loadHistory,
};
