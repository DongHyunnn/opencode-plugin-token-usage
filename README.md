# OTU: OpenCode Token Usage

A VS Code/Cursor extension that combines two sources of truth:

- local OpenCode message history from `~/.local/share/opencode/opencode.db`
- live provider windows from Anthropic and Codex/OpenAI usage APIs

## What it shows

- a status bar headline with provider summaries (live percent or fallback billing)
- a native dashboard tree view with:
  - `Live Rate Limits`
  - `Live Billing`
  - `Monthly Billing`
  - `Monthly Tokens`
  - `Local History`
  - optional `Estimated 7h`
  - `Diagnostics`
- user-selectable local history windows: `1h`, `7h`, `24h`, `7d`, `30d`

## Installation

- Install from the marketplace, or download a VSIX from GitHub Releases and install it directly.
- For local development, open this folder in VS Code or Cursor and launch the Extension Development Host.
- Local history works immediately as long as `sqlite3` is available on `PATH`.
- To install the companion token-tracking plugin, run `OTU: OpenCode Token Usage: Install Tracking Plugin` from the command palette or the dashboard title actions.
- The command copies `opencode-token-usage-tracker.js` into `~/.config/opencode/plugins/`.
- Restart OpenCode after installation so the tracker plugin is loaded.

### GitHub / VSIX install

Download the latest `.vsix` asset from the GitHub Releases page:

`https://github.com/DongHyunnn/opencode-plugin-token-usage/releases`

Build a VSIX locally:

```bash
npm install
npm run package:vsix
```

Install the generated VSIX in VS Code:

```bash
code --install-extension ./opencode-token-usage-extension-*.vsix
```

If the `cursor` shell command is available on your machine, you can use the same VSIX from Cursor:

```bash
cursor --install-extension ./opencode-token-usage-extension-*.vsix
```

Convenience scripts are included:

```bash
npm run install:vsix:vscode:dry-run
npm run install:vsix:cursor:dry-run
```

Then run the real install command after packaging:

```bash
npm run install:vsix:vscode
```

or

```bash
npm run install:vsix:cursor
```

### Marketplace install

Once the extension is published, install it from the VS Code extensions view by searching for `OTU: OpenCode Token Usage`, or from the CLI with:

```bash
code --install-extension DongHyunnn.opencode-token-usage-extension
```

Cursor officially supports extension installation from the Extensions UI. If the `cursor` shell command is available and the same extension id is resolvable there, the equivalent command is:

```bash
cursor --install-extension DongHyunnn.opencode-token-usage-extension
```

### Open VSX / Cursor install

For Cursor/Open VSX compatibility, publish the same extension to Open VSX and install it from the Open VSX-backed extensions UI in Cursor.

If you want to publish manually after creating your Open VSX namespace and token:

```bash
npm run publish:ovsx -- -p "$OVSX_PAT"
```

The release workflow also supports Open VSX publishing when the repository secret `OVSX_PAT` is configured.

## How it works

- OpenCode history is read from the local SQLite `message` table, which already stores provider, model, token, cost, and timestamp metadata.
- Anthropic and Codex live windows still come from provider APIs so their rate-limit windows stay authoritative.
- The optional `7h` section is derived from local history and is intentionally labeled as an estimate.
- The history reader currently shells out to the local `sqlite3` binary, so the host machine needs `sqlite3` available on `PATH`.

## Settings

- `opencodeTokenUsage.databasePath`
- `opencodeTokenUsage.openCodeAuthPath`
- `opencodeTokenUsage.openCodeConfigPath`
- `opencodeTokenUsage.codexAuthPath`
- `opencodeTokenUsage.refreshIntervalSeconds`
- `opencodeTokenUsage.historyWindow`
- `opencodeTokenUsage.showEstimated7h`

These paths are machine-scoped because they point to local editor/runtime state.

## How auth is checked

- **Claude (Anthropic)**: Uses `openCodeAuthPath` (`~/.local/share/opencode/auth.json`), reuses a valid access token until expiry, then refreshes with the stored refresh token. Multiple running extension instances share a single file-backed cache so only one instance hits the API per refresh cycle.
- **Codex/OpenAI**: Reads both `openCodeAuthPath` and `codexAuthPath`; uses valid OpenCode access first; otherwise tries refresh tokens from either path; otherwise falls back to raw Codex access token only when no refresh path exists. Also uses a shared file-backed cache to deduplicate API calls.
- **Gemini**: Three-tier fallback in order:
1. **OAuth quota** (live rate-limit windows): if `openCodeAuthPath` contains a `google.type = "oauth"` entry from the [`opencode-gemini-auth`](https://github.com/jenslys/opencode-gemini-auth) plugin, the extension calls `cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` directly using that token. If the access token is already valid, quota fetch works directly; if the token is expired, automatic refresh now requires local `OTU_GEMINI_OAUTH_CLIENT_ID` and `OTU_GEMINI_OAUTH_CLIENT_SECRET` environment variables before the extension will refresh it.
  2. **Gemini CLI** (live pooled quota): if the `gemini` CLI binary is on `PATH` and authenticated, the extension runs `gemini -o json -y /stats model` to read pooled remaining quota.
  3. **API key / estimateOnly**: if `google.key` is set in `openCodeAuthPath` or `GOOGLE_API_KEY` / `GEMINI_API_KEY` env vars are present, the provider appears in the status bar without live quota data. The extension also detects the `opencode-gemini-auth` plugin via `openCodeConfigPath` (`~/.config/opencode/opencode.json`) and shows estimateOnly in that case.
- **Status bar fallback chain**: `live percent` → `vendor billing` → `estimated local 5h charge`.
- **Diagnostics**: Auth failures are categorized as `not configured`, `expired`, `refresh failed`, or `fetch failed` to help troubleshooting. Gemini project resolution failures report the specific API error from `loadCodeAssist`.

## WSL support

On Windows Subsystem for Linux, the extension automatically translates Windows-style paths (e.g. `C:\Users\...`) to their WSL mount equivalents (`/mnt/c/Users/...`). The `npm run dev` launcher also detects WSL and opens the Extension Development Host via a Remote WSL window if the `ms-vscode-remote.remote-wsl` extension is installed.

## Development

```bash
npm install
npm run dev
npm test
```

Open the folder in VS Code or Cursor and run the extension host from the editor.

## Local testing

- Cursor: open this folder and run the `Run OTU: OpenCode Token Usage Extension` launch configuration.
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

In the Extension Development Host, open the `OTU: OpenCode Token Usage` panel, then run `OTU: OpenCode Token Usage: Refresh` from the command palette if needed.
