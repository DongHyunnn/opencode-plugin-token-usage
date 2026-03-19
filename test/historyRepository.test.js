const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRows, buildHistoryQuery, executeHistoryQuery, loadHistory } = require("../src/lib/historyRepository");

test("parseRows parses sqlite separator output", () => {
  const rows = parseRows("openai|3|120|50|40|30|0|1700000000000\nanthropic|1|20|10|5|5|1.5|1700000000010\n");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].provider, "openai");
  assert.equal(rows[1].totalCost, "1.5");
});

test("buildHistoryQuery includes token and time filters", () => {
  const sql = buildHistoryQuery(1700000000000);
  assert.match(sql, /tokens.total/);
  assert.match(sql, /tokens.cache.read/);
  assert.match(sql, /1700000000000/);
  assert.match(sql, /GROUP BY provider/);
});

test("parseRows preserves monthly cost and token fields", () => {
  const rows = parseRows("google|8|4321|1200|2900|221|9.75|1700000000099\n");
  assert.equal(rows[0].provider, "google");
  assert.equal(rows[0].totalTokens, "4321");
  assert.equal(rows[0].inputTokens, "1200");
  assert.equal(rows[0].outputTokens, "2900");
  assert.equal(rows[0].reasoningTokens, "221");
  assert.equal(rows[0].totalCost, "9.75");
});

test("executeHistoryQuery falls back to python when sqlite3 is unavailable", async () => {
  const calls = [];
  const result = await executeHistoryQuery("/tmp/opencode.db", "select 1", {
    fs: { access: async () => {} },
    execFileAsync: async (command, args) => {
      calls.push([command, args]);
      if (command === "sqlite3" || command === "/usr/bin/sqlite3" || command === "/bin/sqlite3") {
        const error = new Error(`spawn ${command} ENOENT`);
        error.code = "ENOENT";
        throw error;
      }

      assert.equal(command, "python3");
      assert.equal(args[0], "-c");
      assert.equal(args[2], "/tmp/opencode.db");
      assert.equal(args[3], "select 1");
      return { stdout: "openai|2|100|40|40|20|0|1700000000000\n" };
    },
  });

  assert.equal(result.stdout, "openai|2|100|40|40|20|0|1700000000000\n");
  assert.deepEqual(calls.map(([command]) => command), ["sqlite3", "/usr/bin/sqlite3", "/bin/sqlite3", "python3"]);
});

test("loadHistory summarizes rows returned from python fallback", async () => {
  const history = await loadHistory("/tmp/opencode.db", "24h", 1700003600000, {
    fs: { access: async () => {} },
    execFileAsync: async (command) => {
      if (command === "sqlite3" || command === "/usr/bin/sqlite3" || command === "/bin/sqlite3") {
        const error = new Error(`spawn ${command} ENOENT`);
        error.code = "ENOENT";
        throw error;
      }

      return { stdout: "openai|2|100|40|40|20|0|1700000000000\ngoogle|1|50|20|20|10|0.5|1700001000000\n" };
    },
  });

  assert.equal(history.window.key, "24h");
  assert.equal(history.totalMessages, 3);
  assert.equal(history.totalTokens, 150);
  assert.equal(history.totalCost, 0.5);
  assert.equal(history.providers[0].provider, "openai");
  assert.equal(history.providers[1].provider, "google");
});

test("executeHistoryQuery raises a clear error when sqlite and python are unavailable", async () => {
  await assert.rejects(
    executeHistoryQuery("/tmp/opencode.db", "select 1", {
      fs: { access: async () => {} },
      execFileAsync: async (command) => {
        const error = new Error(`spawn ${command} ENOENT`);
        error.code = "ENOENT";
        throw error;
      },
    }),
    /sqlite3 not found; install sqlite3 or python3 with sqlite support/,
  );
});
