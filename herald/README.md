# mana
a Discord bot for Oracle

## Security — key storage

Per-user Predikt API keys registered via `/register` are stored in `keys.json`
(written by `src/storage.ts`, keyed by user id) in **plaintext**. This file is
git-ignored and must **never** be committed. The bot's working directory must
**not** be world-readable: keep it owned by the bot's service user and lock down
permissions (e.g. `chmod 700` the directory / `chmod 600 keys.json`). Anyone who
reads this file can trade as your users.
