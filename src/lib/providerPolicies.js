const PROVIDER_POLICIES = Object.freeze([
  {
    id: "anthropic",
    label: "Claude",
    icon: "❋",
    order: 1,
    supportsRateLimits: true,
    preferredLocalChargeWindow: "rollingFiveHour",
    localChargeSource: "local",
    localChargeLabel: "estimated local 5h",
    preserveLastKnownLiveProvider: true,
  },
  {
    id: "openai",
    label: "Codex",
    icon: "֎",
    order: 2,
    supportsRateLimits: true,
    preferredLocalChargeWindow: "rollingFiveHour",
    localChargeSource: "local",
    localChargeLabel: "estimated local 5h",
    preserveLastKnownLiveProvider: false,
  },
  {
    id: "google",
    label: "Gemini",
    icon: "✦",
    order: 3,
    supportsRateLimits: false,
    preferredLocalChargeWindow: "monthly",
    localChargeSource: "monthly",
    localChargeLabel: "estimated monthly",
    preserveLastKnownLiveProvider: false,
  },
]);

function getProviderPolicy(id) {
  return PROVIDER_POLICIES.find((policy) => policy.id === id);
}

function getSourceLabel(providerId, source, resetText = null) {
  if (source === "live") return resetText ? `reset in ${resetText}` : "live";
  if (source === "vendor") return "actual";
  if (source === "local" || source === "monthly") {
    return "estimated";
  }
  return source;
}

module.exports = {
  PROVIDER_POLICIES,
  getProviderPolicy,
  getSourceLabel,
};
