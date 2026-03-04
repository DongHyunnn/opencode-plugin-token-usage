# opencode-plugin-token-usage

An [OpenCode](https://github.com/opencode-ai/opencode) plugin that monitors your Anthropic Claude and OpenAI Codex token usage in real time.

## Features

- **Live status bar** — Auto-refreshing toast notifications showing usage across providers
- **`check_token_usage` tool** — On-demand usage report with detailed breakdowns
- **Multi-provider** — Supports both Anthropic (Claude) and OpenAI (Codex) simultaneously
- **Rate limit aware** — Automatic backoff on 429s, cached responses to avoid unnecessary API calls

## Installation

```bash
npm install opencode-plugin-token-usage
```

Or add it directly in your OpenCode plugin configuration.

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

## License

MIT
