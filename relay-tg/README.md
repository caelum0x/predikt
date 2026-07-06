# relay-tg

A Telegram companion bot for **Predikt**. It mirrors the [`herald`](../herald)
Discord bot — same backend, same commands — so Predikt can reach users on
another platform.

Built on:
- [grammY](https://grammy.dev) (MIT) — real Telegram Bot API client
- Node's global `fetch` — real HTTP client against the Predikt/oracle backend
  (`ORACLE_API_URL`)

No mocks: every command issues real API calls. Per-user API keys are registered
via `/register` and stored in `keys.json` (keyed by Telegram user id), exactly
like herald.

> **Security — `keys.json` holds users' trading API keys in plaintext.**
> It is git-ignored and must **never** be committed. The bot's working directory
> must **not** be world-readable: keep it owned by the bot's service user and
> lock down permissions (e.g. `chmod 700` the directory / `chmod 600 keys.json`).
> Anyone who reads this file can trade as your users.

## Commands

| Command | Description |
| --- | --- |
| `/start` (or `/help`) | Show help and the command list |
| `/register <api_key>` | Validate (via `GET /me`) and store your Predikt API key |
| `/market <query>` | Search markets by title, show the market and current prices |
| `/bet <amount> <marketId> <outcome>` | Place a bet (`YES`/`NO` for binary, answer text for free-response) |
| `/create <type> \| <question> \| <description> \| <closes YYYY-MM-DD> [\| <extra>]` | Create a market |
| `/portfolio` | Show your balance and aggregated positions |

`/create` is pipe-delimited because Telegram has no typed slash-command options
like Discord. `type` is `BINARY`, `FREE_RESPONSE`, or `NUMERIC`:
- `BINARY` — `extra` is the initial probability `1..99` (default `50`)
- `NUMERIC` — `extra` is `"<min> <max>"`
- `FREE_RESPONSE` — no `extra`

Example:
```
/create BINARY | Will it rain tomorrow? | Local forecast market | 2026-12-31 | 40
```

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Install and configure:
   ```bash
   npm install
   cp .env.example .env
   # edit .env: set BOT_TOKEN (and ORACLE_API_URL if not prod)
   ```

## Environment

| Variable | Required | Description |
| --- | --- | --- |
| `BOT_TOKEN` | yes | Telegram bot token from @BotFather |
| `ORACLE_API_URL` | no | Predikt backend base URL (defaults to prod) |
| `ORACLE_API_KEY` | no | Fallback key for unauthenticated market reads |

## Build & Run

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # emit to ./built
npm start           # node built/index.js
```

For iteration without a build step (Node 22+):
```bash
npm run dev         # runs src/index.ts directly with --experimental-strip-types
```

The bot uses long polling, so no public URL or webhook is required.
