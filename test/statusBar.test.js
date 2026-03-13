const test = require("node:test");
const assert = require("node:assert/strict");

const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "vscode") {
    return {
      window: {
        createStatusBarItem: () => ({
          show: () => {},
          dispose: () => {},
          text: "",
          tooltip: null,
          backgroundColor: undefined,
          command: null,
          name: null,
        }),
      },
      StatusBarAlignment: { Left: 1 },
      ThemeColor: class ThemeColor {
        constructor(id) {
          this.id = id;
        }
      },
      MarkdownString: class MarkdownString {
        constructor(value) {
          this.value = value;
        }
      },
    };
  }
  return originalLoad(request, parent, isMain);
};

const { StatusBarController } = require("../src/ui/statusBar");

test("renders exact compact grammar for three-provider snapshot", () => {
  const mockService = {
    onDidChange: () => {},
    getSnapshot: () => ({
      live: {
        providers: [
          {
            provider: "anthropic",
            windows: [{ id: "anthropic-5h", label: "5h", percentUsed: 5, resetText: "3h 1m" }],
            limitReached: false,
          },
          {
            provider: "openai",
            windows: [{ id: "openai-primary", label: "5h", percentUsed: 4, resetText: "2h 12m" }],
            limitReached: false,
          },
          {
            provider: "google",
            charge: { amount: 5.0 },
          },
        ],
      },
      rollingFiveHourHistory: null,
      refreshedAt: Date.now(),
      diagnostics: [],
    }),
  };

  const controller = new StatusBarController(mockService);
  controller.render(mockService.getSnapshot());

  assert.equal(controller.item.text, "❋ 5%  ֎ 4%  ✦ $5.00");
});

test("omits providers with unavailable summaries", () => {
  const mockService = {
    onDidChange: () => {},
    getSnapshot: () => ({
      live: {
        providers: [
          {
            provider: "anthropic",
            windows: [{ percentUsed: 5 }],
            limitReached: false,
          },
          {
            provider: "openai",
            windows: [],
            limitReached: false,
          },
        ],
      },
      rollingFiveHourHistory: null,
      refreshedAt: Date.now(),
      diagnostics: [],
    }),
  };

  const controller = new StatusBarController(mockService);
  controller.render(mockService.getSnapshot());

  assert.equal(controller.item.text, "❋ 5%");
});

test("falls back to warning when no provider summaries exist", () => {
  const mockService = {
    onDidChange: () => {},
    getSnapshot: () => ({
      live: {
        providers: [],
      },
      rollingFiveHourHistory: null,
      refreshedAt: Date.now(),
      diagnostics: [],
    }),
  };

  const controller = new StatusBarController(mockService);
  controller.render(mockService.getSnapshot());

  assert.equal(controller.item.text, "$(warning) OC usage unavailable");
});

test("includes tooltip lines with source labels", () => {
  const now = Date.now();
  const mockService = {
    onDidChange: () => {},
    getSnapshot: () => ({
      live: {
        providers: [
          {
            provider: "anthropic",
            windows: [{ id: "anthropic-5h", label: "5h", percentUsed: 5, resetText: "3h 1m" }],
            limitReached: false,
          },
          {
            provider: "openai",
            windows: [{ id: "openai-primary", label: "5h", percentUsed: 4, resetText: "2h 12m" }],
            limitReached: false,
          },
          {
            provider: "google",
          },
        ],
      },
      rollingFiveHourHistory: {
        providers: [],
      },
      monthlyHistory: {
        providers: [
          {
            provider: "google",
            totalCost: 5.0,
          },
        ],
      },
      refreshedAt: now,
      diagnostics: [],
    }),
  };

  const controller = new StatusBarController(mockService);
  controller.render(mockService.getSnapshot());

  const tooltip = controller.item.tooltip.value;
  assert(tooltip.includes("Claude: 5% (reset in 3h 1m)"));
  assert(tooltip.includes("Codex: 4% (reset in 2h 12m)"));
  assert(tooltip.includes("Gemini: $5.00 (estimated)"));
  assert(tooltip.includes("Updated"));
});

test("shows charge instead of 5h percent when the 7d window is fully used", () => {
  const mockService = {
    onDidChange: () => {},
    getSnapshot: () => ({
      live: {
        providers: [
          {
            provider: "anthropic",
            windows: [
              { id: "anthropic-5h", label: "5h", percentUsed: 22 },
              { id: "anthropic-7d", label: "7d", percentUsed: 100 },
            ],
            billing: { amountUsed: 9.25, available: true },
            limitReached: false,
          },
        ],
      },
      rollingFiveHourHistory: null,
      refreshedAt: Date.now(),
      diagnostics: [],
    }),
  };

  const controller = new StatusBarController(mockService);
  controller.render(mockService.getSnapshot());

  assert.equal(controller.item.text, "❋ $9.25");
  assert(controller.item.tooltip.value.includes("Claude: $9.25 (actual)"));
});

test("uses estimated local 5h source label for fallback charges", () => {
  const mockService = {
    onDidChange: () => {},
    getSnapshot: () => ({
      live: {
        providers: [
          {
            provider: "google",
          },
        ],
      },
      rollingFiveHourHistory: {
        providers: [],
      },
      monthlyHistory: {
        providers: [
          {
            provider: "google",
            totalCost: 2.5,
          },
        ],
      },
      refreshedAt: Date.now(),
      diagnostics: [],
    }),
  };

  const controller = new StatusBarController(mockService);
  controller.render(mockService.getSnapshot());

  const tooltip = controller.item.tooltip.value;
  assert(tooltip.includes("Gemini: $2.50 (estimated)"));
});

test("sets warning background when diagnostics exist", () => {
  const mockService = {
    onDidChange: () => {},
    getSnapshot: () => ({
      live: {
        providers: [
          {
            provider: "anthropic",
            windows: [{ percentUsed: 5 }],
            limitReached: false,
          },
        ],
      },
      rollingFiveHourHistory: null,
      refreshedAt: Date.now(),
      diagnostics: ["Anthropic auth expired"],
    }),
  };

  const controller = new StatusBarController(mockService);
  controller.render(mockService.getSnapshot());

  assert(controller.item.backgroundColor);
  assert.equal(controller.item.backgroundColor.id, "statusBarItem.warningBackground");
});

test("clears background when no diagnostics", () => {
  const mockService = {
    onDidChange: () => {},
    getSnapshot: () => ({
      live: {
        providers: [
          {
            provider: "anthropic",
            windows: [{ percentUsed: 5 }],
            limitReached: false,
          },
        ],
      },
      rollingFiveHourHistory: null,
      refreshedAt: Date.now(),
      diagnostics: [],
    }),
  };

  const controller = new StatusBarController(mockService);
  controller.render(mockService.getSnapshot());

  assert.equal(controller.item.backgroundColor, undefined);
});

test("preserves command and name properties", () => {
  const mockService = {
    onDidChange: () => {},
    getSnapshot: () => ({
      live: { providers: [] },
      rollingFiveHourHistory: null,
      refreshedAt: Date.now(),
      diagnostics: [],
    }),
  };

  const controller = new StatusBarController(mockService);

  assert.equal(controller.item.command, "opencodeTokenUsage.openDashboard");
  assert.equal(controller.item.name, "OpenCode Token Usage");
});
