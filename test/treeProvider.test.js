const test = require("node:test");
const assert = require("node:assert/strict");

const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "vscode") {
    return {
      TreeItem: class TreeItem {
        constructor(label, collapsibleState) {
          this.label = label;
          this.collapsibleState = collapsibleState;
        }
      },
      TreeItemCollapsibleState: {
        None: 0,
        Expanded: 1,
      },
      EventEmitter: class EventEmitter {
        constructor() {
          this.event = () => {};
        }
        fire() {}
      },
    };
  }
  return originalLoad(request, parent, isMain);
};

const { buildEstimatedSevenHourChildren, buildBillingChildren } = require("../src/ui/treeProvider");

test("estimated 7h card is unavailable without dedicated snapshot", () => {
  const items = buildEstimatedSevenHourChildren({ estimatedSevenHour: null });
  assert.equal(items.length, 1);
  assert.equal(items[0].label, "Estimated");
  assert.equal(items[0].description, "History unavailable");
});

test("estimated 7h card uses dedicated snapshot independent of selected window", () => {
  const items = buildEstimatedSevenHourChildren({
    historyWindow: "24h",
    estimatedSevenHour: {
      totalTokens: 4321,
      providers: [
        { provider: "openai", totalTokens: 3000 },
        { provider: "anthropic", totalTokens: 1321 },
      ],
    },
  });

  assert.equal(items[0].label, "Estimated");
  assert.equal(items[0].description, "4,321 tok");
  assert.equal(items[1].label, "openai");
  assert.equal(items[1].description, "3,000 tok");
  assert.equal(items[2].label, "anthropic");
  assert.equal(items[2].description, "1,321 tok");
});

test("billing card shows unavailable when no summaries can be derived", () => {
  const snapshot = { live: { providers: [] }, rollingFiveHourHistory: null };
  const items = buildBillingChildren(snapshot);
  assert.equal(items.length, 1);
  assert.equal(items[0].label, "Billing unavailable");
  assert.equal(items[0].description, "No live provider data");
});

test("billing card shows vendor billing label for anthropic with billing data", () => {
  const snapshot = {
    live: {
      providers: [
        {
          provider: "anthropic",
          label: "Claude",
          billing: { available: true, amountUsed: 5.0, amountLimit: 100.0, percentUsed: 5 },
          windows: [],
        },
      ],
    },
    rollingFiveHourHistory: null,
  };
  const items = buildBillingChildren(snapshot);
  assert.equal(items.length, 1);
  assert.equal(items[0].label, "Claude");
  assert.ok(items[0].description.includes("vendor billing"), `Expected 'vendor billing' in description, got: ${items[0].description}`);
});

test("billing card shows estimated local 5h for Gemini when only local history available", () => {
  const snapshot = {
    live: { providers: [] },
    rollingFiveHourHistory: {
      providers: [{ provider: "google", totalCost: 2.5 }],
    },
  };
  const items = buildBillingChildren(snapshot);
  const geminiItem = items.find((i) => i.label === "Gemini");
  assert.ok(geminiItem, "Expected a Gemini item in billing children");
  assert.ok(
    geminiItem.description.includes("estimated local 5h"),
    `Expected 'estimated local 5h' in description, got: ${geminiItem.description}`,
  );
});

test("billing card excludes unknown and opencode providers", () => {
  const snapshot = {
    live: {
      providers: [
        { provider: "unknown", label: "Unknown", windows: [] },
        { provider: "opencode", label: "OpenCode", windows: [] },
      ],
    },
    rollingFiveHourHistory: {
      providers: [
        { provider: "unknown", totalCost: 1.0 },
        { provider: "opencode", totalCost: 1.0 },
      ],
    },
  };
  const items = buildBillingChildren(snapshot);
  const labels = items.map((i) => i.label);
  assert.ok(!labels.includes("Unknown"), "unknown provider should be excluded");
  assert.ok(!labels.includes("OpenCode"), "opencode provider should be excluded");
  assert.ok(!labels.includes("unknown"), "unknown provider id should be excluded");
  assert.ok(!labels.includes("opencode"), "opencode provider id should be excluded");
});

test("billing card shows live percent for anthropic with live windows", () => {
  const snapshot = {
    live: {
      providers: [
        {
          provider: "anthropic",
          label: "Claude",
          windows: [{ id: "anthropic-5h", label: "5h", percentUsed: 42 }],
          limitReached: false,
        },
      ],
    },
    rollingFiveHourHistory: null,
  };
  const items = buildBillingChildren(snapshot);
  assert.equal(items.length, 1);
  assert.equal(items[0].label, "Claude");
  assert.ok(items[0].description.includes("42%"), `Expected '42%' in description, got: ${items[0].description}`);
});

test("billing card prefers vendor billing over live percent when provider has both", () => {
  const snapshot = {
    live: {
      providers: [
        {
          provider: "anthropic",
          label: "Claude",
          windows: [{ id: "anthropic-5h", label: "5h", percentUsed: 55 }],
          limitReached: false,
          billing: { available: true, amountUsed: 12.5, amountLimit: 100.0 },
        },
      ],
    },
    rollingFiveHourHistory: null,
  };
  const items = buildBillingChildren(snapshot);
  assert.equal(items.length, 1);
  assert.equal(items[0].label, "Claude");
  assert.ok(
    items[0].description.includes("vendor billing"),
    `Expected 'vendor billing' in description, got: ${items[0].description}`,
  );
  assert.ok(
    !items[0].description.includes("55%"),
    `Expected percent to be absent when billing data exists, got: ${items[0].description}`,
  );
});
