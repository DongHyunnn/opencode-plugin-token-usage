function safePct(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  const pct = n > 1 ? n : n * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function safeRawPct(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toResetMs(resetValue) {
  if (!resetValue) return null;
  if (typeof resetValue === "string") {
    const ms = new Date(resetValue).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  const value = Number(resetValue);
  if (!Number.isFinite(value)) return null;
  return value > 1e12 ? value : value * 1000;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "unknown";
  if (ms <= 0) return "now";

  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatReset(resetValue, now = Date.now()) {
  const resetMs = toResetMs(resetValue);
  if (!resetMs) return "unknown";
  return formatDuration(resetMs - now);
}

function formatRelativeAge(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp)) return "unknown";
  return formatDuration(now - timestamp);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

module.exports = {
  safePct,
  safeRawPct,
  formatReset,
  formatRelativeAge,
  formatNumber,
  formatCurrency,
  toResetMs,
};
