const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const OUTPUT_PATH = path.join(os.homedir(), ".local", "share", "opencode", "token-usage-tracker.jsonl");

async function appendRecord(record) {
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.appendFile(OUTPUT_PATH, `${JSON.stringify(record)}\n`, "utf8");
}

function normalizeMessage(info) {
  if (!info || !info.tokens || !info.providerID) return null;
  return {
    id: info.id ?? null,
    providerID: info.providerID ?? null,
    modelID: info.modelID ?? null,
    cost: info.cost ?? null,
    tokens: info.tokens,
    time: info.time ?? null,
    recordedAt: Date.now(),
  };
}

exports.TokenUsageTrackerPlugin = async () => ({
  event: async ({ event }) => {
    if (event?.type !== "message.updated") return;
    const record = normalizeMessage(event?.properties?.info);
    if (!record) return;
    await appendRecord(record);
  },
});
