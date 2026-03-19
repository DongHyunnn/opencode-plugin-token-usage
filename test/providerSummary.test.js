const test = require("node:test");
const assert = require("node:assert/strict");
const { selectProviderSummaries, selectBillingProviderSummaries } = require("../src/lib/providerSummary");

test("selectProviderSummaries prefers live percent over vendor billing and local cost", () => {
  const summaries = selectProviderSummaries(
    [
      {
        provider: "anthropic",
        windows: [
          { id: "anthropic-5h", label: "5h", percentUsed: 42 },
          { id: "anthropic-7d", label: "7d", percentUsed: 91 },
        ],
        billing: { amountUsed: 12.5, available: true },
        limitReached: false,
      },
    ],
    {
      providers: [{ provider: "anthropic", totalCost: 3.25 }],
    },
  );

  assert.deepEqual(summaries, [
    { provider: "anthropic", source: "live", kind: "percent", value: 42, estimated: false },
  ]);
});

test("selectProviderSummaries falls back to charge when the 7d window is fully used", () => {
  const summaries = selectProviderSummaries(
    [
      {
        provider: "anthropic",
        windows: [
          { id: "anthropic-5h", label: "5h", percentUsed: 18 },
          { id: "anthropic-7d", label: "7d", percentUsed: 100 },
        ],
        billing: { amountUsed: 12.5, available: true },
        limitReached: false,
      },
    ],
    {
      providers: [{ provider: "anthropic", totalCost: 3.25 }],
    },
  );

  assert.deepEqual(summaries, [
    { provider: "anthropic", source: "vendor", kind: "charge", value: 12.5, estimated: false },
  ]);
});

test("selectProviderSummaries falls back to charge when the 5h window is fully used", () => {
  const summaries = selectProviderSummaries(
    [
      {
        provider: "anthropic",
        windows: [
          { id: "anthropic-5h", label: "5h", percentUsed: 100 },
          { id: "anthropic-7d", label: "7d", percentUsed: 82 },
        ],
        billing: { amountUsed: 6.5, available: true },
        limitReached: false,
      },
    ],
    {
      providers: [{ provider: "anthropic", totalCost: 2.5 }],
    },
  );

  assert.deepEqual(summaries, [
    { provider: "anthropic", source: "vendor", kind: "charge", value: 6.5, estimated: false },
  ]);
});

test("selectProviderSummaries still shows 5h percent when provider-level limitReached is true but 5h and 7d are not exhausted", () => {
  const summaries = selectProviderSummaries(
    [
      {
        provider: "openai",
        windows: [
          { id: "openai-primary", label: "5h", percentUsed: 76 },
          { id: "openai-secondary", label: "7d", percentUsed: 89 },
        ],
        billing: { amountUsed: 8.75, available: true },
        limitReached: true,
      },
    ],
    {
      providers: [{ provider: "openai", totalCost: 2.1 }],
    },
  );

  assert.deepEqual(summaries, [
    { provider: "openai", source: "live", kind: "percent", value: 76, estimated: false },
  ]);
});

test("selectProviderSummaries falls back to estimated local 5h charge", () => {
  const summaries = selectProviderSummaries([], null, {
    providers: [{ provider: "google", totalCost: 5 }],
  });

  assert.deepEqual(summaries, [
    { provider: "google", source: "monthly", kind: "charge", value: 5, estimated: true },
  ]);
});

test("selectProviderSummaries keeps non-Gemini local fallback on rolling 5h history", () => {
  const summaries = selectProviderSummaries(
    [],
    { providers: [{ provider: "openai", totalCost: 4.75 }] },
    { providers: [{ provider: "google", totalCost: 9.5 }] },
  );

  assert.deepEqual(summaries, [
    { provider: "openai", source: "local", kind: "charge", value: 4.75, estimated: true },
    { provider: "google", source: "monthly", kind: "charge", value: 9.5, estimated: true },
  ]);
});

test("selectProviderSummaries uses the primary authoritative live window when 5h is absent", () => {
  const summaries = selectProviderSummaries([
    {
      provider: "openai",
      windows: [{ id: "openai-primary", label: "7d", percentUsed: 14 }],
      billing: { amountUsed: 8.75, available: true },
      limitReached: false,
    },
  ]);

  assert.deepEqual(summaries, [
    { provider: "openai", source: "live", kind: "percent", value: 14, estimated: false },
  ]);
});

test("selectProviderSummaries uses Gemini live quota percent when a daily window is available", () => {
  const summaries = selectProviderSummaries([
    {
      provider: "google",
      windows: [{ id: "google-daily", label: "1d", percentUsed: 23, resetText: "10h" }],
      billing: null,
      limitReached: false,
      estimateOnly: false,
    },
  ], null, {
    providers: [{ provider: "google", totalCost: 9.5 }],
  });

  assert.deepEqual(summaries, [
    { provider: "google", source: "live", kind: "percent", value: 23, estimated: false, resetText: "10h" },
  ]);
});

test("selectProviderSummaries falls back to local charge when 7d is exhausted and vendor billing is unavailable", () => {
  const summaries = selectProviderSummaries(
    [
      {
        provider: "openai",
        windows: [
          { id: "openai-primary", label: "5h", percentUsed: 12 },
          { id: "openai-secondary", label: "7d", percentUsed: 100 },
        ],
        billing: null,
        limitReached: false,
      },
    ],
    {
      providers: [{ provider: "openai", totalCost: 4.75 }],
    },
  );

  assert.deepEqual(summaries, [
    { provider: "openai", source: "local", kind: "charge", value: 4.75, estimated: true },
  ]);
});

test("selectProviderSummaries suppresses zero-cost and unknown providers", () => {
  const summaries = selectProviderSummaries(
    [
      {
        provider: "unknown",
        windows: [{ id: "unknown-5h", label: "5h", percentUsed: 55 }],
        limitReached: false,
      },
      {
        provider: "opencode",
        billing: { amountUsed: 9, available: true },
        limitReached: true,
      },
      {
        provider: "google",
        billing: { amountUsed: 0, available: true },
        limitReached: true,
      },
    ],
    {
      providers: [
        { provider: "unknown", totalCost: 7 },
        { provider: "opencode", totalCost: 6 },
        { provider: "google", totalCost: 0 },
      ],
    },
  );

  assert.deepEqual(summaries, []);
});

test("selectProviderSummaries returns summaries in provider catalog order", () => {
  const summaries = selectProviderSummaries(
    [
      {
        provider: "google",
        billing: { amountUsed: 4, available: true },
        limitReached: true,
      },
      {
        provider: "anthropic",
        windows: [{ id: "anthropic-5h", label: "5h", percentUsed: 41 }],
        limitReached: false,
      },
    ],
    {
      providers: [{ provider: "openai", totalCost: 2 }],
    },
  );

  assert.deepEqual(summaries, [
    { provider: "anthropic", source: "live", kind: "percent", value: 41, estimated: false },
    { provider: "openai", source: "local", kind: "charge", value: 2, estimated: true },
    { provider: "google", source: "vendor", kind: "charge", value: 4, estimated: false },
  ]);
});

test("selectBillingProviderSummaries uses provider-managed local charge windows", () => {
  const summaries = selectBillingProviderSummaries(
    [],
    { providers: [{ provider: "openai", totalCost: 2.5 }] },
    { providers: [{ provider: "google", totalCost: 9.75 }] },
  );

  assert.deepEqual(summaries, [
    { provider: "openai", source: "local", kind: "charge", value: 2.5, estimated: true },
    { provider: "google", source: "monthly", kind: "charge", value: 9.75, estimated: true },
  ]);
});
