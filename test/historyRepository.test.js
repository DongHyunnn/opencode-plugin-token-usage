const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRows, buildHistoryQuery } = require("../src/lib/historyRepository");

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
