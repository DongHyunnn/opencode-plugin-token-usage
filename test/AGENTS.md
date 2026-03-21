# TEST GUIDE

## OVERVIEW
Node built-in test suite covering nearly every active module with inline mocks, temp directories, and deterministic snapshots.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Provider auth and quota tests | `test/liveUsage.test.js` | largest file; fallback chains and Gemini cases |
| Runtime orchestration tests | `test/dashboardService.test.js` | rolling `5h`, WSL path translation, snapshot rules |
| Shared lease/cache tests | `test/anthropicSharedState.test.js` | atomic cache and stale lease reclaim |
| UI rendering tests | `test/statusBar.test.js`, `test/treeProvider.test.js` | user-visible strings and card rows |
| History query tests | `test/historyRepository.test.js`, `test/history.test.js` | SQL shape and summary math |
| Provider selection and catalog tests | `test/providerSummary.test.js`, `test/providerCatalog.test.js` | fallback order, filtering, display order |
| Auth runner and install helper tests | `test/authenticatedUsageRunner.test.js`, `test/pluginInstall.test.js` | retry wrapper and tracker copy flow |
| Dev helper tests | `test/devScript.test.js` | editor detection and WSL launch logic |

## CONVENTIONS
- Use `node:test` and `node:assert/strict`; do not introduce Jest/Vitest patterns.
- Name files `{module}.test.js` and keep them at `test/` root.
- Prefer inline fixtures and tiny helper functions over shared global test utilities.
- Use temp dirs plus `t.after(...)` cleanup for filesystem tests.
- Mock `vscode` by patching `Module._load` only as much as the test needs.

## ANTI-PATTERNS
- Do not weaken exact string assertions for status bar, tooltip, or diagnostics unless product wording really changed.
- Do not replace deterministic mocks with real network calls, real editor launches, or real provider APIs.
- Do not merge WSL-specific behavior into generic tests; keep conditional Linux skips where needed.
- Do not add nested test structure unless the suite outgrows the flat layout in a meaningful way.

## NOTES
- Current suite mirrors source modules closely; if you add a new active module, add or extend a matching test file.
- `test/liveUsage.test.js` is the main regression net for provider behavior.
