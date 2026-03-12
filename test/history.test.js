const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeHistoryRows } = require("../src/lib/history");

test("summarizeHistoryRows aggregates provider totals", () => {
  const summary = summarizeHistoryRows(
    [
      {
        provider: "openai",
        messageCount: "4",
        totalTokens: "1200",
        inputTokens: "400",
        outputTokens: "700",
        reasoningTokens: "100",
        totalCost: "1.25",
        lastAt: "1700000000200",
      },
      {
        provider: "anthropic",
        messageCount: "2",
        totalTokens: "600",
        inputTokens: "200",
        outputTokens: "300",
        reasoningTokens: "100",
        totalCost: "0",
        lastAt: "1700000000100",
      },
    ],
    "24h",
    1700000000300,
  );

  assert.equal(summary.totalMessages, 6);
  assert.equal(summary.totalTokens, 1800);
  assert.equal(summary.providers[0].provider, "openai");
  assert.equal(summary.providers[1].provider, "anthropic");
});
