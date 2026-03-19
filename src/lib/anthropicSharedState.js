const fs = require("node:fs/promises");
const path = require("node:path");

const ANTHROPIC_CACHE_FILE = "claude-live-usage.json";
const ANTHROPIC_LEASE_DIR = "claude-live-usage.lock";
const OPENAI_CACHE_FILE = "codex-live-usage.json";
const OPENAI_LEASE_DIR = "codex-live-usage.lock";
const SHARED_LEASE_META_FILE = "owner.json";
const SHARED_LEASE_TTL_MS = 60_000;
const SHARED_FOLLOWER_WAIT_MS = 1_500;
const SHARED_FOLLOWER_POLL_MS = 150;

function getSharedPaths(openCodeAuthPath, cacheFile, leaseDir) {
  const directory = path.dirname(openCodeAuthPath);
  return {
    directory,
    cachePath: path.join(directory, cacheFile),
    leasePath: path.join(directory, leaseDir),
    leaseMetaPath: path.join(directory, leaseDir, SHARED_LEASE_META_FILE),
  };
}

function getAnthropicSharedPaths(openCodeAuthPath) {
  return getSharedPaths(openCodeAuthPath, ANTHROPIC_CACHE_FILE, ANTHROPIC_LEASE_DIR);
}

function getOpenAISharedPaths(openCodeAuthPath) {
  return getSharedPaths(openCodeAuthPath, OPENAI_CACHE_FILE, OPENAI_LEASE_DIR);
}

async function readSharedCache(sharedPaths, dependencies = {}) {
  const fsApi = dependencies.fs || fs;

  try {
    const raw = await fsApi.readFile(sharedPaths.cachePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeSharedCache(sharedPaths, value, dependencies = {}) {
  const fsApi = dependencies.fs || fs;
  const tempPath = `${sharedPaths.cachePath}.${process.pid}.${Date.now()}.tmp`;

  await fsApi.mkdir(sharedPaths.directory, { recursive: true });
  await fsApi.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsApi.rename(tempPath, sharedPaths.cachePath);
}

async function readSharedLease(sharedPaths, dependencies = {}) {
  const fsApi = dependencies.fs || fs;

  try {
    const raw = await fsApi.readFile(sharedPaths.leaseMetaPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isSharedLeaseExpired(lease, now = Date.now()) {
  return !lease || !Number.isFinite(lease.expiresAt) || lease.expiresAt <= now;
}

async function acquireSharedLease(sharedPaths, holderId, now = Date.now(), dependencies = {}) {
  const fsApi = dependencies.fs || fs;
  await fsApi.mkdir(sharedPaths.directory, { recursive: true });

  try {
    await fsApi.mkdir(sharedPaths.leasePath);
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }

    const currentLease = await readSharedLease(sharedPaths, dependencies);
    if (!currentLease || isSharedLeaseExpired(currentLease, now)) {
      await fsApi.rm(sharedPaths.leasePath, { recursive: true, force: true });
      await fsApi.mkdir(sharedPaths.leasePath);
    } else {
      return false;
    }
  }

  await fsApi.writeFile(sharedPaths.leaseMetaPath, `${JSON.stringify({ holderId, expiresAt: now + SHARED_LEASE_TTL_MS }, null, 2)}\n`, "utf8");
  return true;
}

async function releaseSharedLease(sharedPaths, holderId, dependencies = {}) {
  const fsApi = dependencies.fs || fs;
  const currentLease = await readSharedLease(sharedPaths, dependencies);
  if (currentLease && currentLease.holderId !== holderId) {
    return;
  }

  await fsApi.rm(sharedPaths.leasePath, { recursive: true, force: true });
}

async function waitForSharedCache(sharedPaths, minimumRefreshedAt, dependencies = {}) {
  const sleep = dependencies.sleep || defaultSleep;
  const deadline = Date.now() + SHARED_FOLLOWER_WAIT_MS;

  while (Date.now() < deadline) {
    const cache = await readSharedCache(sharedPaths, dependencies);
    if (cache && Number(cache.refreshedAt) >= minimumRefreshedAt) {
      return cache;
    }
    await sleep(SHARED_FOLLOWER_POLL_MS);
  }

  return readSharedCache(sharedPaths, dependencies);
}

function isSharedCacheFresh(cache, intervalSeconds, now = Date.now()) {
  if (!cache || !Number.isFinite(cache.refreshedAt)) return false;
  const freshnessMs = Math.max(10, Number(intervalSeconds) || 45) * 1000;
  return now - cache.refreshedAt <= freshnessMs;
}

async function readAnthropicSharedCache(openCodeAuthPath, dependencies = {}) {
  return readSharedCache(getAnthropicSharedPaths(openCodeAuthPath), dependencies);
}

async function writeAnthropicSharedCache(openCodeAuthPath, value, dependencies = {}) {
  return writeSharedCache(getAnthropicSharedPaths(openCodeAuthPath), value, dependencies);
}

async function acquireAnthropicLease(openCodeAuthPath, holderId, now = Date.now(), dependencies = {}) {
  return acquireSharedLease(getAnthropicSharedPaths(openCodeAuthPath), holderId, now, dependencies);
}

async function releaseAnthropicLease(openCodeAuthPath, holderId, dependencies = {}) {
  return releaseSharedLease(getAnthropicSharedPaths(openCodeAuthPath), holderId, dependencies);
}

async function waitForAnthropicSharedCache(openCodeAuthPath, minimumRefreshedAt, dependencies = {}) {
  return waitForSharedCache(getAnthropicSharedPaths(openCodeAuthPath), minimumRefreshedAt, dependencies);
}

function isAnthropicCacheFresh(cache, intervalSeconds, now = Date.now()) {
  return isSharedCacheFresh(cache, intervalSeconds, now);
}

async function readOpenAISharedCache(openCodeAuthPath, dependencies = {}) {
  return readSharedCache(getOpenAISharedPaths(openCodeAuthPath), dependencies);
}

async function writeOpenAISharedCache(openCodeAuthPath, value, dependencies = {}) {
  return writeSharedCache(getOpenAISharedPaths(openCodeAuthPath), value, dependencies);
}

async function acquireOpenAILease(openCodeAuthPath, holderId, now = Date.now(), dependencies = {}) {
  return acquireSharedLease(getOpenAISharedPaths(openCodeAuthPath), holderId, now, dependencies);
}

async function releaseOpenAILease(openCodeAuthPath, holderId, dependencies = {}) {
  return releaseSharedLease(getOpenAISharedPaths(openCodeAuthPath), holderId, dependencies);
}

async function waitForOpenAISharedCache(openCodeAuthPath, minimumRefreshedAt, dependencies = {}) {
  return waitForSharedCache(getOpenAISharedPaths(openCodeAuthPath), minimumRefreshedAt, dependencies);
}

function isOpenAICacheFresh(cache, intervalSeconds, now = Date.now()) {
  return isSharedCacheFresh(cache, intervalSeconds, now);
}

function defaultSleep(waitMs) {
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

module.exports = {
  ANTHROPIC_CACHE_FILE,
  ANTHROPIC_LEASE_DIR,
  OPENAI_CACHE_FILE,
  OPENAI_LEASE_DIR,
  SHARED_FOLLOWER_POLL_MS,
  SHARED_FOLLOWER_WAIT_MS,
  SHARED_LEASE_TTL_MS,
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
};
