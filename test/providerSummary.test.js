const test = require("node:test");
const assert = require("node:assert/strict");
const { selectProviderSummaries } = require("../src/lib/providerSummary");

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
  const summaries = selectProviderSummaries([], {
    providers: [{ provider: "google", totalCost: 5 }],
  });

  assert.deepEqual(summaries, [
    { provider: "google", source: "local", kind: "charge", value: 5, estimated: true },
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
