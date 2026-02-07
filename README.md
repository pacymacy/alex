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
   - Set `autonomy.enabled`, `autonomy.goalMode`, and `autonomy.personality.active`.
   - In `llm.providerOrder`, keep your preferred API order.
   - Add your real key(s) under `llm.openrouter.apiKey`, `llm.gemini.apiKey`, or `llm.openai.apiKey`.
4. Install deps: `npm install`
5. Run: `npm start`
6. Optional deterministic planner checks: `npm run test:scenarios`

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

## Project layout

- `config/config.example.json` unified config template
- `config/config.local.json` local runtime config (ignored by git)
- `data/waypoints.json` local waypoint memory (ignored by git)
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
- `!alex mission <text>`
- `!alex auto on|off`
- `!alex mode auto|manual`
- `!alex persona`
- `!alex persona list`
- `!alex persona set <default|cave_dweller>`
- `!alex persona stage`
- `!alex persona lock|unlock`
- `!alex wp set <name>`
- `!alex wp goto <name>`
- `!alex wp del <name>`
- `!alex wp list`
- `!alex safety on|off`
- `!alex status`
- `!alex tick`

## Built-in behavior upgrades

- Safety loop before each LLM plan:
  - auto-eat when hungry/weak and food exists
  - panic flee when low health and hostiles are near
  - clear low-value inventory overflow when slots are critically low
  - run night shelter fallback (return home if known, otherwise place emergency torch)
- Autonomy loop (when `autonomy.enabled=true` and mode is `auto`):
  - sets home waypoint
  - gathers wood
  - crafts planks/sticks/tools/table/furnace/torches
  - mines stone/coal
  - patrols around home
- Cave-dweller personality (stage CD-0 to CD-3 baseline):
  - avoids surface at night
  - retreats underground on surface threats
  - prioritizes torch/coal/iron reserve and underground mining progression
- Action execution now emits structured `reasonCode` values on failures (for example `NO_TOOL`, `NO_PATH`, `NO_DROP`, `NO_RECIPE`, `TIMEOUT`)
- Action postconditions are enforced for `mine_block`, `craft_item`, `place_block`, `eat_food`, and `goto_waypoint`
- Persistent waypoints:
  - saved to `data/waypoints.json`
  - usable from owner commands and LLM waypoint actions
- LLM action support includes:
  - `craft_item`
  - `place_block`
  - `eat_food`
  - `flee_hostiles`
  - `goto_waypoint`
  - `set_waypoint`
  - `delete_waypoint`
