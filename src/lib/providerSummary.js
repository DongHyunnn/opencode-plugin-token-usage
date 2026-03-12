const { normalizeProvider } = require("./history");
const { PROVIDER_CATALOG } = require("./providerCatalog");

function selectProviderSummaries(liveProviders = [], rollingFiveHourHistory = null) {
  const liveByProvider = indexProviders(liveProviders);
  const historyByProvider = indexProviders(rollingFiveHourHistory?.providers);
  const summaries = [];

  for (const { id } of PROVIDER_CATALOG) {
    const liveProvider = liveByProvider.get(id);
    const livePercent = getLivePercent(liveProvider);
    if (livePercent !== null) {
      summaries.push({ provider: id, source: "live", kind: "percent", value: livePercent, estimated: false });
      continue;
    }

    const vendorCharge = getVendorCharge(liveProvider);
    if (vendorCharge !== null) {
      summaries.push({ provider: id, source: "vendor", kind: "charge", value: vendorCharge, estimated: false });
      continue;
    }

    const localCharge = getLocalCharge(historyByProvider.get(id));
    if (localCharge !== null) {
      summaries.push({ provider: id, source: "local", kind: "charge", value: localCharge, estimated: true });
    }
  }

  return summaries;
}

/**
 * Billing-first variant: prefers vendor billing/charge over live percent.
 * Used by the Live Billing card so that real billing data is always surfaced
 * even when the provider also has live rate-limit windows.
 */
function selectBillingProviderSummaries(liveProviders = [], rollingFiveHourHistory = null) {
  const liveByProvider = indexProviders(liveProviders);
  const historyByProvider = indexProviders(rollingFiveHourHistory?.providers);
  const summaries = [];

  for (const { id } of PROVIDER_CATALOG) {
    const liveProvider = liveByProvider.get(id);

    const vendorCharge = getVendorCharge(liveProvider);
    if (vendorCharge !== null) {
      summaries.push({ provider: id, source: "vendor", kind: "charge", value: vendorCharge, estimated: false });
      continue;
    }

    const livePercent = getLivePercent(liveProvider);
    if (livePercent !== null) {
      summaries.push({ provider: id, source: "live", kind: "percent", value: livePercent, estimated: false });
      continue;
    }

    const localCharge = getLocalCharge(historyByProvider.get(id));
    if (localCharge !== null) {
      summaries.push({ provider: id, source: "local", kind: "charge", value: localCharge, estimated: true });
    }
  }

  return summaries;
}

function indexProviders(providers) {
  const indexed = new Map();
  for (const provider of Array.isArray(providers) ? providers : []) {
    const providerId = normalizeProvider(provider?.provider);
    if (!indexed.has(providerId)) {
      indexed.set(providerId, provider);
    }
  }
  return indexed;
}

function getLivePercent(provider) {
  if (!provider) return null;
  const windows = Array.isArray(provider.windows) ? provider.windows : [];
  const sevenDayWindow = windows.find(isSevenDayWindow);
  if (isWindowExhausted(sevenDayWindow)) return null;

  const fiveHourWindow = windows.find(isFiveHourWindow);
  if (isWindowExhausted(fiveHourWindow)) return null;

  if (fiveHourWindow) {
    return getFiniteNumber(fiveHourWindow.percentUsed);
  }

  if (provider.limitReached) return null;

  const preferredWindow = windows[0];
  return getFiniteNumber(preferredWindow?.percentUsed);
}

function isFiveHourWindow(window) {
  const id = String(window?.id ?? "").toLowerCase();
  const label = String(window?.label ?? "").toLowerCase();
  return label === "5h" || id.endsWith("-5h");
}

function isSevenDayWindow(window) {
  const id = String(window?.id ?? "").toLowerCase();
  const label = String(window?.label ?? "").toLowerCase();
  return label === "7d" || id.endsWith("-7d");
}

function isWindowExhausted(window) {
  const percentUsed = getFiniteNumber(window?.percentUsed);
  return percentUsed !== null && percentUsed >= 100;
}

function getVendorCharge(provider) {
  if (!provider) return null;
  return getBillingCharge(provider.billing) ?? getChargeAmount(provider.charge);
}

function getBillingCharge(billing) {
  if (!billing || billing.available === false) return null;
  return getPositiveNumber(billing.amountUsed ?? billing.amount ?? billing.value);
}

function getChargeAmount(charge) {
  if (charge == null || charge.available === false) return null;
  if (typeof charge !== "object") return getPositiveNumber(charge);
  return getPositiveNumber(charge.amount ?? charge.amountUsed ?? charge.value ?? charge.total);
}

function getLocalCharge(provider) {
  return getPositiveNumber(provider?.totalCost ?? provider?.cost ?? provider?.value);
}

function getFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getPositiveNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

module.exports = {
  selectProviderSummaries,
  selectBillingProviderSummaries,
};
