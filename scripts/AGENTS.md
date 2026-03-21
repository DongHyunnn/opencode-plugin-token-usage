# SCRIPTS GUIDE

## OVERVIEW
Operational helpers for local development and VSIX installation. These are contributor tools, not shipped runtime modules.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Launch extension host locally | `scripts/dev.js` | detects `cursor`/`code`, supports WSL fallback |
| Install packaged VSIX | `scripts/install-vsix.js` | validates editor arg and local VSIX presence |
| Debug launch equivalent | `.vscode/launch.json` | editor-driven extension host config |
| Release automation | `.github/workflows/release.yml` | CI counterpart to local package/install flow |

## CONVENTIONS
- Keep scripts runnable with plain Node from repo root.
- Fail with explicit stderr/stdout guidance; these scripts are user-facing developer tooling.
- Preserve WSL-aware behavior in `scripts/dev.js`; it is not incidental convenience code.
- Read package metadata from `package.json` instead of duplicating versioned filenames.

## ANTI-PATTERNS
- Do not assume Cursor supports every VS Code flag; current logic probes support first.
- Do not hardcode a single local editor path; WSL fallback logic intentionally searches standard installs.
- Do not skip dry-run support when adding script behavior that launches or installs anything.
- Do not make packaging/install scripts depend on files excluded by `.vscodeignore` at publish time.

## NOTES
- `npm run dev -- --dry-run` is the quickest way to verify path resolution without opening an editor.
- `scripts/install-vsix.js` expects a prebuilt VSIX named from `package.json` version.
- Release workflow and local scripts should stay aligned on Node 20 behavior and VSIX naming.
- The scripts directory is excluded from shipped VSIX contents, so changes here only affect contributors and CI flows.
