# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-21 Asia/Seoul
**Commit:** `777dbb0`
**Branch:** `main`

## OVERVIEW
VS Code/Cursor workspace extension that combines local OpenCode SQLite history with live provider quota and billing data. Pure CommonJS Node.js, no build step, minimal dependency surface.

## STRUCTURE
```text
./
|- src/        core extension code; see child guides for lib and ui
|- test/       node:test suite mirroring modules
|- scripts/    local dev and VSIX install helpers
|- resources/  shipped OpenCode tracker plugin asset
|- media/      extension icons and activity assets
|- README.md   user-facing behavior, auth fallback chain, install flow
`- package.json extension manifest, commands, settings, release scripts
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Extension startup and command wiring | `src/extension.js` | activate/deactivate, commands, tree view, status bar |
| Shared constants and defaults | `src/constants.js` | window options, default paths, provider constants |
| Runtime orchestration | `src/lib/dashboardService.js` | refresh cycle, file watchers, config reloads |
| Provider auth and live usage | `src/lib/liveUsage.js` | biggest module; Anthropic/OpenAI/Gemini flows |
| Local history queries | `src/lib/historyRepository.js` | shells out to `sqlite3`, falls back to Python |
| Status bar text rules | `src/ui/statusBar.js` | compact provider summary grammar |
| Dashboard sections | `src/ui/treeProvider.js` | tree cards and visible descriptions |
| Provider fallback regression coverage | `test/liveUsage.test.js` | canonical provider/auth behavior checks |
| UI output regression coverage | `test/statusBar.test.js`, `test/treeProvider.test.js` | visible strings and tree rows |
| Release pipeline | `.github/workflows/release.yml` | Node 20, test, package, marketplace publish |
| Local development | `scripts/dev.js` | editor detection, WSL handling, extension host launch |
| Tracker plugin asset | `resources/opencode-token-usage-tracker.js` | copied into `~/.config/opencode/plugins/` |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `activate` | function | `src/extension.js:8` | startup entry | wires service, tree, status bar, commands |
| `DashboardService` | class | `src/lib/dashboardService.js:12` | central | owns refresh state, watchers, config, snapshots |
| `loadLiveUsage` | function | `src/lib/liveUsage.js:908` | central | merges provider API, CLI, OAuth, cache flows |
| `loadHistory` | function | `src/lib/historyRepository.js:57` | central | reads OpenCode message history for windows |
| `DashboardTreeProvider` | class | `src/ui/treeProvider.js:8` | UI | builds dashboard card rows |
| `StatusBarController` | class | `src/ui/statusBar.js:7` | UI | renders compact status text and tooltip |
| `run` | function | `scripts/dev.js:104` | scripts | launches Extension Development Host |

## CONVENTIONS
- CommonJS only: `require` + `module.exports`; no TypeScript, no bundler, no transpile step.
- Runtime dependencies stay near-zero; current code relies on Node built-ins plus VS Code API.
- Tests use Node's built-in runner: `node --test`, `node:assert/strict`, inline mocks, temp dirs.
- Config lives in `package.json`; there is no ESLint/Prettier/Biome layer to rescue style drift.
- Release automation assumes Node 20 in CI even though the runtime surface is mostly plain Node.
- Path-oriented settings are machine-scoped because they point at local auth/config/database paths.

## ANTI-PATTERNS (THIS PROJECT)
- Do not add heavy startup work in `activate`; the extension activates on `onStartupFinished` and should stay light.
- Do not bypass provider fallback order without checking README and tests; Gemini and Codex flows are intentionally layered.
- Do not introduce workspace-trust-sensitive behavior casually; manifest declares support in untrusted workspaces.
- Do not assume local-only editor paths; dev flow and runtime both contain WSL path translation logic.

## UNIQUE STYLES
- Root guide is a router: deeper instructions live in child `AGENTS.md` files instead of repeating folder detail here.
- Provider UI favors real billing over live percent when both exist, but status bar falls back through live -> vendor -> local estimate.
- Diagnostics are user-visible product behavior, not just logs; preserve message wording carefully.

## COMMANDS
```bash
npm test
npm run dev
npm run dev -- --dry-run
npm run package:vsix
npm run install:vsix:vscode:dry-run
npm run install:vsix:cursor:dry-run
```

## NOTES
- Read `README.md` before touching auth or quota logic; it documents the current provider fallback contract.
- `src/lib/liveUsage.js` is the main complexity hotspot; pair changes there with `test/liveUsage.test.js`.
- `.vscodeignore` excludes `scripts/`, `test/`, and CI metadata from shipped VSIX contents.
