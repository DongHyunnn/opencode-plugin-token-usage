# UI GUIDE

## OVERVIEW
Thin VS Code presentation layer: one status bar controller and one tree provider built on `DashboardService` snapshots.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Status bar rendering | `src/ui/statusBar.js` | compact provider grammar, tooltip, warning background |
| Dashboard tree sections | `src/ui/treeProvider.js` | card sections, leaf descriptions, diagnostics |
| Data source contract | `src/lib/dashboardService.js` | snapshot fields consumed by UI |
| Display/source wording | `src/lib/providerSummary.js`, `src/lib/providerPolicies.js` | live vs actual vs estimated labels |

## CONVENTIONS
- Keep UI files dumb; compute fallback/business rules in `src/lib`, not in view code.
- Match existing visible strings exactly when possible; tests assert user-facing grammar.
- Use plain VS Code APIs directly (`TreeItem`, `StatusBarItem`, `MarkdownString`); no wrapper layer.
- Preserve section order in the tree unless product behavior intentionally changes.

## ANTI-PATTERNS
- Do not move provider-selection logic into UI files.
- Do not change tooltip/status wording casually; tests pin exact output patterns.
- Do not show unavailable or unknown providers just because data exists; catalog filtering is intentional.
- Do not hide reset timing from visible rate-limit rows; descriptions are part of the UX contract.

## NOTES
- `src/ui` has only two files; keep it that way unless a new UI surface truly appears.
- UI tests use lightweight `vscode` module mocks in `test/statusBar.test.js` and `test/treeProvider.test.js`.
- The dashboard intentionally exposes diagnostics as visible rows instead of hiding them in logs or dev tools.
- Billing cards and status bar intentionally do not share identical fallback wording; each surface optimizes for its own density.
