# opencode-plugin-token-usage

An [OpenCode](https://github.com/opencode-ai/opencode) plugin that monitors your Anthropic Claude and OpenAI Codex token usage in real time.

## Features

- **Live status bar** — Auto-refreshing toast notifications showing usage across providers
- **`check_token_usage` tool** — On-demand usage report with detailed breakdowns
- **Multi-provider** — Supports both Anthropic (Claude) and OpenAI (Codex) simultaneously
- **Rate limit aware** — Automatic backoff on 429s, cached responses to avoid unnecessary API calls
- **Auto OAuth refresh** — Automatically refreshes expired Anthropic/OpenAI access tokens and retries usage requests

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/DongHyunnn/opencode-plugin-token-usage/main/install.sh | bash
```

The script clones the plugin and automatically adds it to your `~/.config/opencode/opencode.json`. Safe to re-run — won't duplicate entries.

Then restart OpenCode to activate.

<details>
<summary>Manual installation</summary>

```bash
cd ~/.config/opencode/plugins
git clone https://github.com/DongHyunnn/opencode-plugin-token-usage.git
```

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "oh-my-opencode@latest",
    "./plugins/opencode-plugin-token-usage"
  ]
}
```
</details>

## Usage

### Status Bar (Automatic)

Once installed, the plugin automatically displays a compact toast showing usage for all configured providers. It refreshes every 20 seconds and looks like:

```
▸ Claude
  5h   🟩🟩🟩🟩⬛   20%  ↻ 2h 30m
  7d   🟩🟩🟩⬛⬛   40%  ↻ 4d 12h 0m
────────────────────────────────
▸ Codex
  5h   🟩🟩🟩🟩🟩    5%  ↻ 3h 15m
  7d   🟩🟩🟩🟩⬛   18%  ↻ 5d 8h 0m
```
<img width="1750" height="1269" alt="image" src="https://github.com/user-attachments/assets/5c5b1f72-1c07-4a9c-9ad6-027b203aecc7" />

### Tool (On-Demand)

Invoke `check_token_usage` to get a detailed markdown report:

```
check_token_usage(provider: "all" | "anthropic" | "openai")
```

The report includes:

- Progress bars with percentage used/remaining
- Time until each window resets
- Extra usage (pay-as-you-go) details for Anthropic
- Rate limit status for Codex

## Authentication

The plugin reads OAuth tokens from:

| Provider  | Token Location                               |
|-----------|----------------------------------------------|
| Anthropic | `~/.local/share/opencode/auth.json`          |
| OpenAI    | `~/.codex/auth.json` or OpenCode auth store  |

No additional configuration needed — just sign in through OpenCode or the respective CLI.

### Automatic token refresh behavior

- Anthropic: refreshes on expired access token or `401` from usage API
- OpenAI/Codex: refreshes on missing/invalid access token or `401`/`403` from usage API
- Updated access and refresh tokens are persisted back to local auth files

If refresh fails (for example, revoked refresh token), re-authenticate with `opencode auth login`.

## License

MIT
