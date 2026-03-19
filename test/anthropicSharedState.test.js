const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  acquireAnthropicLease,
  acquireOpenAILease,
  getAnthropicSharedPaths,
  getOpenAISharedPaths,
  isAnthropicCacheFresh,
  isOpenAICacheFresh,
  readAnthropicSharedCache,
  readOpenAISharedCache,
  releaseAnthropicLease,
  releaseOpenAILease,
  waitForAnthropicSharedCache,
  waitForOpenAISharedCache,
  writeAnthropicSharedCache,
  writeOpenAISharedCache,
} = require("../src/lib/anthropicSharedState");

test("acquireAnthropicLease grants the first holder and blocks a second", async (t) => {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), "anthropic-shared-state-"));
  t.after(() => fs.rm(dirPath, { recursive: true, force: true }));
  const authPath = path.join(dirPath, "auth.json");

  assert.equal(await acquireAnthropicLease(authPath, "holder-a", 1000), true);
  assert.equal(await acquireAnthropicLease(authPath, "holder-b", 1000), false);
  await releaseAnthropicLease(authPath, "holder-a");
  assert.equal(await acquireAnthropicLease(authPath, "holder-b", 1000), true);
});

test("acquireAnthropicLease reclaims stale leases", async (t) => {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), "anthropic-shared-state-"));
  t.after(() => fs.rm(dirPath, { recursive: true, force: true }));
  const authPath = path.join(dirPath, "auth.json");
  const sharedPaths = getAnthropicSharedPaths(authPath);

  await fs.mkdir(sharedPaths.leasePath, { recursive: true });
  await fs.writeFile(sharedPaths.leaseMetaPath, `${JSON.stringify({ holderId: "stale", expiresAt: 1000 })}\n`, "utf8");

  assert.equal(await acquireAnthropicLease(authPath, "holder-b", 2000), true);
});

test("writeAnthropicSharedCache stores cache atomically and readAnthropicSharedCache returns it", async (t) => {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), "anthropic-shared-state-"));
  t.after(() => fs.rm(dirPath, { recursive: true, force: true }));
  const authPath = path.join(dirPath, "auth.json");

  const value = { provider: { provider: "anthropic" }, refreshedAt: Date.now(), diagnostics: [] };
  await writeAnthropicSharedCache(authPath, value);

  assert.deepEqual(await readAnthropicSharedCache(authPath), value);
});

test("waitForAnthropicSharedCache observes a later writer", async (t) => {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), "anthropic-shared-state-"));
  t.after(() => fs.rm(dirPath, { recursive: true, force: true }));
  const authPath = path.join(dirPath, "auth.json");
  const refreshedAt = Date.now();

  const writer = setTimeout(() => {
    void writeAnthropicSharedCache(authPath, { provider: { provider: "anthropic" }, diagnostics: [], refreshedAt: refreshedAt + 5 });
  }, 50);
  t.after(() => clearTimeout(writer));

  const cache = await waitForAnthropicSharedCache(authPath, refreshedAt);
  assert.equal(cache.provider.provider, "anthropic");
  assert.equal(isAnthropicCacheFresh(cache, 45, refreshedAt + 100), true);
});

test("OpenAI shared state mirrors Anthropic lease and cache behavior", async (t) => {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), "openai-shared-state-"));
  t.after(() => fs.rm(dirPath, { recursive: true, force: true }));
  const authPath = path.join(dirPath, "auth.json");
  const sharedPaths = getOpenAISharedPaths(authPath);

  assert.equal(await acquireOpenAILease(authPath, "holder-a", 1000), true);
  assert.equal(await acquireOpenAILease(authPath, "holder-b", 1000), false);

  const cacheValue = { provider: { provider: "openai" }, diagnostics: [], refreshedAt: Date.now() };
  await writeOpenAISharedCache(authPath, cacheValue);
  assert.deepEqual(await readOpenAISharedCache(authPath), cacheValue);
  assert.equal(isOpenAICacheFresh(cacheValue, 45), true);

  const writer = setTimeout(() => {
    void writeOpenAISharedCache(authPath, { provider: { provider: "openai" }, diagnostics: [], refreshedAt: cacheValue.refreshedAt + 5 });
  }, 50);
  t.after(() => clearTimeout(writer));

  const waited = await waitForOpenAISharedCache(authPath, cacheValue.refreshedAt);
  assert.equal(waited.provider.provider, "openai");

  await releaseOpenAILease(authPath, "holder-a");
  await fs.mkdir(sharedPaths.leasePath, { recursive: true });
});
