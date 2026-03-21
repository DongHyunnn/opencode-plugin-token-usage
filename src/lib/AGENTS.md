# LIB GUIDE

## OVERVIEW
Core runtime logic lives here: history loading, provider auth, cache coordination, billing selection, install helpers, and formatting utilities.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Refresh orchestration | `src/lib/dashboardService.js` | snapshot shape, watchers, config, polling |
| Provider auth and quota fetch | `src/lib/liveUsage.js` | biggest file; Anthropic/OpenAI/Gemini branches |
| Shared lease/cache logic | `src/lib/anthropicSharedState.js` | file-backed dedupe across extension instances |
| Generic auth/fetch retry flow | `src/lib/authenticatedUsageRunner.js` | provider-agnostic retry wrapper |
| SQL history access | `src/lib/historyRepository.js` | `sqlite3` first, Python fallback second |
| History aggregation | `src/lib/history.js` | provider normalization, window summaries |
| UI-facing provider selection | `src/lib/providerSummary.js` | live/billing/local fallback policy |
| Provider metadata and source labels | `src/lib/providerCatalog.js`, `src/lib/providerPolicies.js` | display order, labels, source wording |
| Plugin install helper | `src/lib/pluginInstall.js` | copies tracker asset into OpenCode plugin dir |

## CONVENTIONS
- Keep modules small and single-purpose except `liveUsage.js`, which is the intentional integration hub.
- Export plain functions or one focused class; avoid deep inheritance or framework-style registries.
- Prefer dependency injection hooks already present in tests (`dependencies`, mocked `execFileAsync`, mocked `fs`).
- Preserve CommonJS exports and current file naming (`camelCase.js`).
- Treat diagnostics as product strings; changing wording can break tests and user-facing expectations.

## ANTI-PATTERNS
- Do not add a dynamic provider plugin system; provider catalog and policies are intentionally static.
- Do not skip shared-cache writes or lease release paths around provider fetches.
- Do not drop the `sqlite3` -> Python fallback chain unless tests and README change with it.
- Do not fold `5h`, selected window, and `30d` history into one query result; downstream UI depends on separate snapshots.
- Do not make Gemini look authoritative when only API key or plugin detection is present; `estimateOnly` matters.
- Do not silence fetch/auth errors; diagnostics are how the UI explains failures.

## NOTES
- Complexity hotspot: `src/lib/liveUsage.js` plus `test/liveUsage.test.js`.
- Cache files and lease directories sit beside auth files, not inside the workspace.
- `historyRepository` subtracts cached token reads from totals on purpose.
