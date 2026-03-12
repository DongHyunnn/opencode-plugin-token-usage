const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PROVIDER_CATALOG,
  getCatalogEntry,
  isRecognizedProvider,
  filterAndSortProviders,
} = require("../src/lib/providerCatalog");

test("PROVIDER_CATALOG contains exactly three entries", () => {
  assert.equal(PROVIDER_CATALOG.length, 3);
});

test("anthropic entry has correct label, icon, and order", () => {
  const entry = getCatalogEntry("anthropic");
  assert.ok(entry, "anthropic must be in catalog");
  assert.equal(entry.label, "Claude");
  assert.equal(entry.icon, "❋");
  assert.equal(entry.order, 1);
});

test("openai entry has correct label, icon, and order", () => {
  const entry = getCatalogEntry("openai");
  assert.ok(entry, "openai must be in catalog");
  assert.equal(entry.label, "Codex");
  assert.equal(entry.icon, "֎");
  assert.equal(entry.order, 2);
});

test("google entry has correct label, icon, and order", () => {
  const entry = getCatalogEntry("google");
  assert.ok(entry, "google must be in catalog");
  assert.equal(entry.label, "Gemini");
  assert.equal(entry.icon, "✦");
  assert.equal(entry.order, 3);
});

test("getCatalogEntry returns undefined for unrecognized ids", () => {
  assert.equal(getCatalogEntry("unknown"), undefined);
  assert.equal(getCatalogEntry("opencode"), undefined);
  assert.equal(getCatalogEntry(""), undefined);
  assert.equal(getCatalogEntry("ANTHROPIC"), undefined);
});

test("isRecognizedProvider returns true for catalog ids", () => {
  assert.equal(isRecognizedProvider("anthropic"), true);
  assert.equal(isRecognizedProvider("openai"), true);
  assert.equal(isRecognizedProvider("google"), true);
});

test("isRecognizedProvider returns false for excluded ids", () => {
  assert.equal(isRecognizedProvider("unknown"), false);
  assert.equal(isRecognizedProvider("opencode"), false);
  assert.equal(isRecognizedProvider(""), false);
  assert.equal(isRecognizedProvider("ANTHROPIC"), false);
});

test("filterAndSortProviders excludes unknown and opencode", () => {
  const input = [
    { id: "unknown", label: "Unknown" },
    { id: "opencode", label: "OpenCode" },
    { id: "anthropic", label: "Claude" },
  ];
  const result = filterAndSortProviders(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "anthropic");
});

test("filterAndSortProviders sorts by canonical catalog order", () => {
  const input = [
    { id: "google", label: "Gemini" },
    { id: "anthropic", label: "Claude" },
    { id: "openai", label: "Codex" },
  ];
  const result = filterAndSortProviders(input);
  assert.equal(result.length, 3);
  assert.equal(result[0].id, "anthropic");
  assert.equal(result[1].id, "openai");
  assert.equal(result[2].id, "google");
});

test("filterAndSortProviders preserves original object properties", () => {
  const input = [
    { id: "openai", label: "Codex", windows: [{ id: "openai-primary" }] },
    { id: "anthropic", label: "Claude", windows: [] },
  ];
  const result = filterAndSortProviders(input);
  assert.equal(result[0].id, "anthropic");
  assert.deepEqual(result[0].windows, []);
  assert.equal(result[1].id, "openai");
  assert.equal(result[1].windows.length, 1);
});

test("filterAndSortProviders returns empty array when all providers are unrecognized", () => {
  const input = [
    { id: "unknown" },
    { id: "opencode" },
    { id: "mystery" },
  ];
  const result = filterAndSortProviders(input);
  assert.equal(result.length, 0);
});

test("PROVIDER_CATALOG is frozen and cannot be mutated", () => {
  assert.throws(() => {
    PROVIDER_CATALOG.push({ id: "evil", label: "Evil", icon: "$(x)", order: 99 });
  });
});
