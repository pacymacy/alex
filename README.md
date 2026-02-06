# alex

Minecraft Java bot starter that uses an LLM API to plan actions while you watch in-game.

Use one tracked template and one local file:
- tracked: `config/config.example.json`
- local (ignored): `config/config.local.json`

The bot checks configured providers in order and uses the first one with a valid key.
If the current provider fails, it falls back to the next one automatically.

## Setup

1. Install Node.js 18+ (`20 LTS` recommended).
2. Create local config:
   - macOS/Linux: `cp config/config.example.json config/config.local.json`
   - PowerShell: `Copy-Item config/config.example.json config/config.local.json`
3. Edit `config/config.local.json`:
   - Set `ownerUsername`.
   - Set `minecraft.host` / `minecraft.port` / `minecraft.version` / `minecraft.auth`.
   - In `llm.providerOrder`, keep your preferred API order.
   - Add your real key(s) under `llm.openrouter.apiKey`, `llm.gemini.apiKey`, or `llm.openai.apiKey`.
4. Install deps: `npm install`
5. Run: `npm start`

## Minecraft host and port

- Singleplayer LAN:
  - Open world to LAN.
  - Use `minecraft.host = "127.0.0.1"`.
  - Set `minecraft.port` to the LAN port shown in Minecraft chat.
- Dedicated server:
  - Use your server host/IP and configured port (often `25565`).

## Secrets safety

- Real keys go only in `config/config.local.json` (gitignored).
- Keep `config/config.example.json` with placeholders only.
- Run `npm run scan:secrets` before commit.

If a key was already committed:
1. Revoke/rotate the key now.
2. Rewrite history before making repo public.

Small repo reset:
```bash
git checkout --orphan clean-main
git add -A
git commit -m "Clean history without secrets"
git branch -M main
git push --force-with-lease origin main
```

## Project layout

- `config/config.example.json` unified config template
- `config/config.local.json` local runtime config (ignored by git)
- `src/index.js` main runtime loop
- `src/config.js` config loader and normalization
- `src/llm/client.js` provider failover client (OpenRouter/Gemini/OpenAI compatible)
- `src/llm/prompt.js` planner prompt
- `src/minecraft/observe.js` world state snapshot
- `src/minecraft/actions.js` action executor
- `scripts/scan-secrets.mjs` quick tracked-file secret scanner

## In-game owner commands

Use these from the owner username configured in `config/config.local.json`:
- `!alex help`
- `!alex pause`
- `!alex resume`
- `!alex goal <text>`
- `!alex status`
- `!alex tick`
