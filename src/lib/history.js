const { WINDOW_OPTIONS } = require("../constants");

function normalizeProvider(provider) {
  if (!provider) return "unknown";
  return String(provider).toLowerCase();
}

function getWindow(windowKey) {
  return WINDOW_OPTIONS[windowKey] || WINDOW_OPTIONS["24h"];
}

function summarizeHistoryRows(rows, windowKey, now = Date.now()) {
  const window = getWindow(windowKey);
  const providers = new Map();
  let totalTokens = 0;
  let totalCost = 0;
  let lastAt = 0;
  let totalMessages = 0;

  for (const row of rows) {
    const provider = normalizeProvider(row.provider);
    const messageCount = Number(row.messageCount) || 0;
    const providerTotalTokens = Number(row.totalTokens) || 0;
    const providerInputTokens = Number(row.inputTokens) || 0;
    const providerOutputTokens = Number(row.outputTokens) || 0;
    const providerReasoningTokens = Number(row.reasoningTokens) || 0;
    const providerTotalCost = Number(row.totalCost) || 0;
    const providerLastAt = Number(row.lastAt) || 0;

    providers.set(provider, {
      provider,
      messageCount,
      totalTokens: providerTotalTokens,
      inputTokens: providerInputTokens,
      outputTokens: providerOutputTokens,
      reasoningTokens: providerReasoningTokens,
      totalCost: providerTotalCost,
      lastAt: providerLastAt,
    });

    totalMessages += messageCount;
    totalTokens += providerTotalTokens;
    totalCost += providerTotalCost;
    lastAt = Math.max(lastAt, providerLastAt);
  }

  return {
    window,
    startAt: now - window.ms,
    endAt: now,
    totalMessages,
    totalTokens,
    totalCost,
    lastAt,
    providers: Array.from(providers.values()).sort((left, right) => right.totalTokens - left.totalTokens),
  };
}

module.exports = {
  normalizeProvider,
  getWindow,
  summarizeHistoryRows,
};
