# OpenCode Token Usage

A VS Code/Cursor extension that combines two sources of truth:

- local OpenCode message history from `~/.local/share/opencode/opencode.db`
- live provider windows from Anthropic and Codex/OpenAI usage APIs

## What it shows

- a status bar headline with provider summaries (live percent or fallback billing)
- a native dashboard tree view with:
  - `Live Rate Limits`
  - `Live Billing`
  - `Local History`
  - optional `Estimated 7h`
  - `Diagnostics`
- user-selectable local history windows: `1h`, `7h`, `24h`, `7d`

## How it works

- OpenCode history is read from the local SQLite `message` table, which already stores provider, model, token, cost, and timestamp metadata.
- Anthropic and Codex live windows still come from provider APIs so their rate-limit windows stay authoritative.
- The optional `7h` section is derived from local history and is intentionally labeled as an estimate.
- The history reader currently shells out to the local `sqlite3` binary, so the host machine needs `sqlite3` available on `PATH`.

## Settings

- `opencodeTokenUsage.databasePath`
- `opencodeTokenUsage.openCodeAuthPath`
- `opencodeTokenUsage.codexAuthPath`
- `opencodeTokenUsage.refreshIntervalSeconds`
- `opencodeTokenUsage.historyWindow`
- `opencodeTokenUsage.showEstimated7h`

These paths are machine-scoped because they point to local editor/runtime state.

## How auth is checked

- **Claude (Anthropic)**: Uses `openCodeAuthPath` to read `~/.local/share/opencode/auth.json`, reuses a valid `anthropic` access token until expiry, then refreshes with the stored refresh token.
- **Codex/OpenAI**: Reads both `openCodeAuthPath` and `codexAuthPath`; uses valid OpenCode access first; otherwise tries refresh tokens from either path; otherwise falls back to raw Codex access token only when no refresh path exists.
- **Gemini**: Reuses the existing `google.key` entry from `openCodeAuthPath` and is estimate-only (no live quota endpoint).
- **Status bar fallback chain**: `live percent` → `vendor billing` → `estimated local 5h charge`.
- **Gemini quota visibility**: Official quota and spend remain visible in [AI Studio](https://aistudio.google.com) because the Gemini Developer API does not expose a lightweight authoritative remaining-quota endpoint.
- **Diagnostics**: Auth failures are categorized as `not configured`, `expired`, `refresh failed`, or `fetch failed` to help troubleshooting.

## Development

```bash
npm install
npm run dev
npm test
```

Open the folder in VS Code or Cursor and run the extension host from the editor.

## Local testing

- Cursor: open this folder and run the `Run OpenCode Token Usage Extension` launch configuration.
- VS Code: same flow; the repo now includes `.vscode/launch.json`.
- One-command launcher:

```bash
npm run dev
```

- Dry-run command resolution:

```bash
npm run dev -- --dry-run
```

- CLI alternative:

```bash
cursor --extensionDevelopmentPath="$(pwd)"
```

or

```bash
code --extensionDevelopmentPath="$(pwd)"
```

In the Extension Development Host, open the `OpenCode Usage` panel, then run `OpenCode Token Usage: Refresh` from the command palette if needed.
