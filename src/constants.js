const path = require("node:path");
const os = require("node:os");

const DEFAULT_PATHS = {
  databasePath: path.join(os.homedir(), ".local", "share", "opencode", "opencode.db"),
  openCodeAuthPath: path.join(os.homedir(), ".local", "share", "opencode", "auth.json"),
  openCodeConfigPath: path.join(os.homedir(), ".config", "opencode", "opencode.json"),
  codexAuthPath: path.join(os.homedir(), ".codex", "auth.json"),
};

const ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const ANTHROPIC_OAUTH_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const ANTHROPIC_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ANTHROPIC_RATE_LIMIT_BACKOFF_MS = 300_000;
const DEFAULT_LIVE_REFRESH_INTERVAL_SECONDS = 45;

const WINDOW_OPTIONS = {
  "1h": { key: "1h", label: "Last 1 hour", ms: 60 * 60 * 1000 },
  "7h": { key: "7h", label: "Last 7 hours", ms: 7 * 60 * 60 * 1000 },
  "24h": { key: "24h", label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  "7d": { key: "7d", label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  "30d": { key: "30d", label: "Last 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
};

const ROLLING_FIVE_HOUR_WINDOW = { key: "5h", label: "Last 5 hours", ms: 5 * 60 * 60 * 1000 };

Object.defineProperty(WINDOW_OPTIONS, ROLLING_FIVE_HOUR_WINDOW.key, {
  value: ROLLING_FIVE_HOUR_WINDOW,
  enumerable: false,
});

module.exports = {
  DEFAULT_PATHS,
  WINDOW_OPTIONS,
  ROLLING_FIVE_HOUR_WINDOW,
  ANTHROPIC_USAGE_URL,
  CODEX_USAGE_URL,
  ANTHROPIC_OAUTH_TOKEN_URL,
  OPENAI_OAUTH_TOKEN_URL,
  ANTHROPIC_OAUTH_CLIENT_ID,
  OPENAI_OAUTH_CLIENT_ID,
  ANTHROPIC_RATE_LIMIT_BACKOFF_MS,
  DEFAULT_LIVE_REFRESH_INTERVAL_SECONDS,
};
