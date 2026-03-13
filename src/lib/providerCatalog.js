/**
 * Fixed catalog of recognized status-bar providers.
 *
 * Only these three external providers are allowed in the always-on status bar.
 * The catalog is intentionally static: no dynamic registry, no plugin framework.
 * Downstream tasks (ordering, labels, icons) must consume this module directly.
 */

const { PROVIDER_POLICIES } = require("./providerPolicies");

/** @type {ReadonlyArray<{id: string, label: string, icon: string, order: number}>} */
const PROVIDER_CATALOG = Object.freeze(PROVIDER_POLICIES.map(({ id, label, icon, order }) => ({
  id,
  label,
  icon,
  order,
})));

/** Set of recognized provider ids for fast membership checks. */
const RECOGNIZED_IDS = new Set(PROVIDER_CATALOG.map((p) => p.id));

/**
 * Returns the catalog entry for a given provider id, or undefined if not recognized.
 *
 * @param {string} id
 * @returns {{ id: string, label: string, icon: string, order: number } | undefined}
 */
function getCatalogEntry(id) {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}

/**
 * Returns true when the provider id is in the recognized catalog.
 * Excludes "unknown", "opencode", and any other unrecognized ids.
 *
 * @param {string} id
 * @returns {boolean}
 */
function isRecognizedProvider(id) {
  return RECOGNIZED_IDS.has(id);
}

/**
 * Filters an array of provider objects to only recognized catalog entries,
 * then sorts them by canonical catalog order (ascending).
 *
 * Each item must have an `id` property matching a catalog provider id.
 *
 * @template {{ id: string }} T
 * @param {T[]} providers
 * @returns {T[]}
 */
function filterAndSortProviders(providers) {
  return providers
    .filter((p) => isRecognizedProvider(p.id))
    .sort((a, b) => {
      const orderA = getCatalogEntry(a.id)?.order ?? Infinity;
      const orderB = getCatalogEntry(b.id)?.order ?? Infinity;
      return orderA - orderB;
    });
}

module.exports = {
  PROVIDER_CATALOG,
  getCatalogEntry,
  isRecognizedProvider,
  filterAndSortProviders,
};
