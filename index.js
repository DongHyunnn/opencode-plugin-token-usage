import { tool } from "@opencode-ai/plugin/tool";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Auth file paths ──────────────────────────────────────────────────
const OPENCODE_AUTH = join(homedir(), ".local", "share", "opencode", "auth.json");
const CODEX_AUTH = join(homedir(), ".codex", "auth.json");

// ── Endpoints ────────────────────────────────────────────────────────
const ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

const TOAST_THROTTLE_MS = 5_000;
const TOAST_DURATION_MS = 30_000;
const STATUS_REFRESH_MS = 20_000;
const ANTHROPIC_REFRESH_MS = 60_000;
const ANTHROPIC_RATE_LIMIT_BACKOFF_MS = 300_000;

/** Horizontal line between agent blocks in toast (visual separation) */
const AGENT_SEPARATOR = "────────────────────────────────";

/** Column widths for aligned compact layout */
const COL = { WINDOW: 3, PCT: 4, RESET: 12 };

// ── Helpers ──────────────────────────────────────────────────────────

async function readJson(path) {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Safely parse a utilization value (0-1 ratio or raw percent) into 0-100 integer */
function safePct(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  // Anthropic returns 0-1 ratio, Codex returns 0-100 percent
  // If value > 1, assume it's already a percentage
  const pct = n > 1 ? n : n * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/** Safely parse a value that is already a 0-100 percent */
function safeRawPct(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function progressBar(pct, width = 20) {
  const safePctVal = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  const filled = Math.round((safePctVal / 100) * width);
  const empty = Math.max(0, width - filled);
  return `[${"█".repeat(Math.max(0, filled))}${"░".repeat(empty)}]`;
}

function formatReset(resetValue) {
  if (!resetValue) return "unknown";
  const now = Date.now();
  // Handle ISO date strings (e.g. "2026-03-03T19:00:00.841825+00:00")
  // as well as unix timestamps in seconds or milliseconds
  let resetMs;
  if (typeof resetValue === "string") {
    resetMs = new Date(resetValue).getTime();
  } else {
    resetMs = resetValue > 1e12 ? resetValue : resetValue * 1000;
  }
  if (!Number.isFinite(resetMs)) return "unknown";
  const diffMs = resetMs - now;
  if (diffMs <= 0) return "now";
  const hours = Math.floor(diffMs / 3_600_000);
  const mins = Math.floor((diffMs % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function compactReset(resetValue) {
  if (!resetValue) return "?";
  const now = Date.now();
  let resetMs;
  if (typeof resetValue === "string") {
    resetMs = new Date(resetValue).getTime();
  } else {
    resetMs = resetValue > 1e12 ? resetValue : resetValue * 1000;
  }
  if (!Number.isFinite(resetMs)) return "?";
  const diffMs = resetMs - now;
  if (diffMs <= 0) return "now";
  const days = Math.floor(diffMs / 86_400_000);
  const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
  const mins = Math.floor((diffMs % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function statusEmoji(pct) {
  if (pct < 50) return "🟢";
  if (pct < 75) return "🟡";
  if (pct < 90) return "🟠";
  return "🔴";
}

function coloredSquares(pct) {
  const total = 5;
  const usedCount = Math.round((pct / 100) * total);
  const remainingCount = total - usedCount;
  const colorSquare = remainingCount >= 4 ? "🟩" : remainingCount >= 2 ? "🟨" : "🟥";
  return colorSquare.repeat(remainingCount) + "⬛".repeat(usedCount);
}

function isTokenExpired(expiresMs) {
  if (!expiresMs) return false; // no expiry info → assume valid
  return Date.now() >= expiresMs;
}

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
}

// ── Anthropic (Claude) ───────────────────────────────────────────────

async function fetchAnthropicUsage(accessToken) {
  const res = await fetch(ANTHROPIC_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function formatAnthropicUsage(data) {
  const lines = ["## Anthropic (Claude)", ""];

  const fiveHour = data.five_hour ?? data.fiveHour;
  const sevenDay = data.seven_day ?? data.sevenDay;

  if (fiveHour) {
    const pct = safePct(fiveHour.utilization);
    const remaining = 100 - pct;
    lines.push(
      `**5h Window** ${statusEmoji(pct)}`,
      `  ${progressBar(pct)} ${pct}% used · ${remaining}% remaining`,
      `  Resets in: ${formatReset(fiveHour.resets_at ?? fiveHour.reset)}`,
      "",
    );
  }

  if (sevenDay) {
    const pct = safePct(sevenDay.utilization);
    const remaining = 100 - pct;
    lines.push(
      `**7d Window** ${statusEmoji(pct)}`,
      `  ${progressBar(pct)} ${pct}% used · ${remaining}% remaining`,
      `  Resets in: ${formatReset(sevenDay.resets_at ?? sevenDay.reset)}`,
      "",
    );
  }

  // Extra usage (pay-as-you-go overage)
  const extra = data.extra_usage;
  if (extra?.is_enabled) {
    const used = extra.used_credits ?? 0;
    const limit = extra.monthly_limit ?? 0;
    const extraPct = limit > 0 ? safeRawPct((used / limit) * 100) : 0;
    lines.push(
      `**Extra Usage** ${statusEmoji(extraPct)}`,
      `  $${used.toFixed(0)} / $${limit.toFixed(0)} (${extraPct}%)`,
      "",
    );
  }

  if (!fiveHour && !sevenDay) {
    lines.push("  No usage data returned.", "");
  }

  return lines.join("\n");
}

// ── OpenAI / Codex ───────────────────────────────────────────────────

async function fetchCodexUsage(accessToken) {
  const res = await fetch(CODEX_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Codex ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function formatWindowLabel(seconds) {
  if (!seconds) return "unknown";
  const hours = seconds / 3600;
  if (hours <= 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function formatCodexUsage(data) {
  const lines = ["## OpenAI (Codex)", ""];

  if (data.plan_type) {
    lines.push(`  Plan: **${data.plan_type}**`, "");
  }

  const rl = data.rate_limit;
  if (!rl) {
    lines.push("  No rate limit data returned.", "");
    return lines.join("\n");
  }

  if (rl.primary_window) {
    const w = rl.primary_window;
    const pct = safeRawPct(w.used_percent);
    const remaining = 100 - pct;
    const label = formatWindowLabel(w.limit_window_seconds);
    lines.push(
      `**${label} Window** ${statusEmoji(pct)}`,
      `  ${progressBar(pct)} ${pct}% used · ${remaining}% remaining`,
      `  Resets in: ${formatReset(w.reset_at)}`,
      "",
    );
  }

  if (rl.secondary_window) {
    const w = rl.secondary_window;
    const pct = safeRawPct(w.used_percent);
    const remaining = 100 - pct;
    const label = formatWindowLabel(w.limit_window_seconds);
    lines.push(
      `**${label} Window** ${statusEmoji(pct)}`,
      `  ${progressBar(pct)} ${pct}% used · ${remaining}% remaining`,
      `  Resets in: ${formatReset(w.reset_at)}`,
      "",
    );
  }

  if (rl.additional_rate_limits?.length) {
    for (const extra of rl.additional_rate_limits) {
      if (!extra) continue;
      const name = extra.limit_name ?? extra.limit_id ?? "Additional";
      lines.push(`  **${name}**: see /status for details`);
    }
    lines.push("");
  }

  if (rl.limit_reached) {
    lines.push("  ⚠️  **LIMIT REACHED** — usage blocked until reset", "");
  }

  return lines.join("\n");
}

// ── Compact status for toast ─────────────────────────────────────────

function compactLine(windowLabel, pct, reset) {
  const w = String(windowLabel).padEnd(COL.WINDOW);
  const squares = coloredSquares(pct);
  const p = String(pct).padStart(3) + "%";
  const r = String(reset).padEnd(COL.RESET);
  return `  ${w}  ${squares}  ${p.padEnd(COL.PCT)}  ↻ ${r}`;
}

function compactAnthropicStatus(data) {
  const fiveHour = data.five_hour ?? data.fiveHour;
  const sevenDay = data.seven_day ?? data.sevenDay;
  const lines = ["▸ Claude"];
  if (fiveHour) {
    const pct = safePct(fiveHour.utilization);
    const reset = compactReset(fiveHour.resets_at ?? fiveHour.reset);
    lines.push(compactLine("5h", pct, reset));
  }
  if (sevenDay) {
    const pct = safePct(sevenDay.utilization);
    const reset = compactReset(sevenDay.resets_at ?? sevenDay.reset);
    lines.push(compactLine("7d", pct, reset));
  }
  if (lines.length <= 1) return null;
  return lines.join("\n");
}

function compactCodexStatus(data) {
  const rl = data.rate_limit;
  if (!rl) return null;
  const lines = ["▸ Codex"];
  if (rl.primary_window) {
    const w = rl.primary_window;
    const pct = safeRawPct(w.used_percent);
    const reset = compactReset(w.reset_at);
    const label = formatWindowLabel(w.limit_window_seconds);
    lines.push(compactLine(label, pct, reset));
  }
  if (rl.secondary_window) {
    const w = rl.secondary_window;
    const pct = safeRawPct(w.used_percent);
    const reset = compactReset(w.reset_at);
    const label = formatWindowLabel(w.limit_window_seconds);
    lines.push(compactLine(label, pct, reset));
  }
  if (rl.limit_reached) {
    lines.push("  ⚠️ LIMIT REACHED");
  }
  if (lines.length <= 1) return null;
  return lines.join("\n");
}

// ── Status bar (event-driven, throttled) ─────────────────────────────

function createStatusBar(client) {
  let lastUpdateAt = 0;
  let updating = false;
  let refreshTimer = null;
  let lastAnthropicData = null;
  let lastAnthropicFetchAt = 0;
  let anthropicBackoffUntil = 0;

  async function update() {
    const now = Date.now();
    if (now - lastUpdateAt < TOAST_THROTTLE_MS) return;
    if (updating) return;
    updating = true;
    lastUpdateAt = now;

    try {
      const opencodeAuth = await readJson(OPENCODE_AUTH);
      const codexAuth = await readJson(CODEX_AUTH);
      const parts = [];
      const warnings = [];

      // ── Anthropic ──
      const anthropicToken = opencodeAuth?.anthropic?.access;
      if (anthropicToken) {
        if (isTokenExpired(opencodeAuth?.anthropic?.expires)) {
          warnings.push("Claude: token expired");
        } else {
          const canUseCache =
            lastAnthropicData &&
            now - lastAnthropicFetchAt < ANTHROPIC_REFRESH_MS;

          if (canUseCache) {
            const s = compactAnthropicStatus(lastAnthropicData);
            if (s) parts.push(s);
          } else if (now < anthropicBackoffUntil && lastAnthropicData) {
            const s = compactAnthropicStatus(lastAnthropicData);
            if (s) parts.push(s);
          } else {
            try {
              const data = await fetchAnthropicUsage(anthropicToken);
              lastAnthropicData = data;
              lastAnthropicFetchAt = now;
              const s = compactAnthropicStatus(data);
              if (s) parts.push(s);
            } catch (error) {
              lastAnthropicFetchAt = now;
              const message = getErrorMessage(error);
              if (message.includes("Anthropic 429")) {
                anthropicBackoffUntil = now + ANTHROPIC_RATE_LIMIT_BACKOFF_MS;
                if (lastAnthropicData) {
                  const s = compactAnthropicStatus(lastAnthropicData);
                  if (s) parts.push(s);
                } else {
                  warnings.push("Claude: rate limited, retrying soon");
                }
              } else if (message.includes("Anthropic 401")) {
                warnings.push("Claude: auth expired");
              } else {
                warnings.push("Claude: fetch failed");
              }
            }
          }
        }
      }

      // ── OpenAI ──
      const codexToken =
        codexAuth?.tokens?.access_token ?? opencodeAuth?.openai?.access;
      if (codexToken) {
        try {
          const data = await fetchCodexUsage(codexToken);
          const s = compactCodexStatus(data);
          if (s) parts.push(s);
        } catch {
          warnings.push("Codex: fetch failed");
        }
      }

      const message =
        parts.length > 0
          ? [parts.join("\n" + AGENT_SEPARATOR + "\n"), ...warnings].join("\n")
          : warnings.join("\n");
      if (!message) return;

      const hasWarning = warnings.length > 0;
      const variant = hasWarning ? "warning" : "info";

      await client.tui.showToast({
        body: {
          title: "⚡ Token Usage",
          message,
          variant,
          duration: TOAST_DURATION_MS,
        },
      });
    } catch {
      // silently ignore — don't break the event loop
    } finally {
      updating = false;
    }
  }

  function start() {
    if (refreshTimer) return;
    refreshTimer = setInterval(() => {
      void update();
    }, STATUS_REFRESH_MS);

    if (typeof refreshTimer?.unref === "function") {
      refreshTimer.unref();
    }

    void update();
  }

  return { update, start };
}

// ── Plugin entry point ───────────────────────────────────────────────

export const TokenUsagePlugin = async (ctx) => {
  const { client } = ctx;
  const statusBar = createStatusBar(client);

  statusBar.start();

  return {
    // ── Event-driven status bar: update on any opencode event ──
    async event({ event }) {
      // Throttle inside update() ensures max 1 call per TOAST_THROTTLE_MS
      statusBar.update();
    },

    tool: {
      check_token_usage: tool({
        description:
          "Check remaining token usage (5-hour and weekly) for Anthropic Claude and OpenAI Codex. Shows utilization percentage, remaining capacity, and reset times.",
        args: {
          provider: tool.schema
            .enum(["all", "anthropic", "openai"])
            .describe(
              "Which provider to check: 'all', 'anthropic', or 'openai'",
            )
            .optional()
            .default("all"),
        },
        async execute(args) {
          const provider = args.provider ?? "all";
          const sections = [];
          const errors = [];

          // ── Load auth tokens ──
          const opencodeAuth = await readJson(OPENCODE_AUTH);
          const codexAuth = await readJson(CODEX_AUTH);

          // ── Anthropic ──
          if (provider === "all" || provider === "anthropic") {
            const token = opencodeAuth?.anthropic?.access;
            if (!token) {
              errors.push(
                "Anthropic: No OAuth token found. Sign in via OpenCode (provider auth) first.",
              );
            } else if (isTokenExpired(opencodeAuth?.anthropic?.expires)) {
              errors.push(
                "Anthropic: Access token expired. Re-authenticate in OpenCode settings.",
              );
            } else {
              try {
                const data = await fetchAnthropicUsage(token);
                sections.push(formatAnthropicUsage(data));
              } catch (e) {
                errors.push(`Anthropic: ${e.message}`);
              }
            }
          }

          // ── OpenAI / Codex ──
          if (provider === "all" || provider === "openai") {
            const token =
              codexAuth?.tokens?.access_token ?? opencodeAuth?.openai?.access;
            if (!token) {
              errors.push(
                "OpenAI: No access token found. Sign in via Codex CLI or OpenCode first.",
              );
            } else {
              try {
                const data = await fetchCodexUsage(token);
                sections.push(formatCodexUsage(data));
              } catch (e) {
                errors.push(`OpenAI: ${e.message}`);
              }
            }
          }

          // ── Compose output ──
          const output = [];
          output.push("# Token Usage Report", "");
          output.push(
            `*Checked at: ${new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })}*`,
            "",
          );

          if (sections.length) {
            output.push(sections.join("\n" + AGENT_SEPARATOR + "\n\n"));
          }

          if (errors.length) {
            output.push("---", "", "### Errors", "");
            for (const err of errors) {
              output.push(`- ${err}`);
            }
            output.push("");
          }

          if (!sections.length && !errors.length) {
            output.push("No providers configured or reachable.");
          }

          return output.join("\n");
        },
      }),
    },
  };
};

// ── Preview: run with `node index.js --preview` to print sample toast output ──
if (process.argv.includes("--preview")) {
  const mockAnthropic = {
    five_hour: {
      utilization: 0.45,
      resets_at: Date.now() + 2.5 * 3600 * 1000,
    },
    seven_day: {
      utilization: 0.6,
      resets_at: Date.now() + 5 * 24 * 3600 * 1000,
    },
  };
  const mockCodex = {
    rate_limit: {
      primary_window: {
        used_percent: 22,
        reset_at: Date.now() + 4 * 3600 * 1000,
        limit_window_seconds: 5 * 3600,
      },
      secondary_window: {
        used_percent: 18,
        reset_at: Date.now() + 6 * 24 * 3600 * 1000,
        limit_window_seconds: 7 * 24 * 3600,
      },
    },
  };
  const parts = [];
  const s1 = compactAnthropicStatus(mockAnthropic);
  if (s1) parts.push(s1);
  const s2 = compactCodexStatus(mockCodex);
  if (s2) parts.push(s2);
  console.log("\n⚡ Token Usage (preview)\n");
  console.log(parts.join("\n" + AGENT_SEPARATOR + "\n"));
  console.log("");
  process.exit(0);
}
