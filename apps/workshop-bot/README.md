# apps/workshop-bot/

**Status: scaffolding only.** Implementation hasn't started.

Planned: a four-agent Discord bot — Eddy, Linky, Marky, Patty — that collaborates on weekly newsletter drafts. Single Python process running four `discord.py` clients concurrently via `asyncio.gather`, each authenticated with its own bot token. Agents share an in-memory corpus loaded from `librarian_core` and a SQLite database under `data/`.

## Planned layout

- `team.py` — single entrypoint, four bot clients
- `personas/{eddy,linky,marky,patty}.py` — per-agent logic
- `prompts/` — editable per-persona system prompts
- `tools/` — shared agent tools (corpus retrieval, S3 publish, etc.)
- `db/` — SQLite schema + client
- `scheduler.py` — weekly cadence
- `data/` — gitignored, holds `workshop.db`

## Storage rule

- SQLite at `data/workshop.db` — operational state, agent outputs, analytics, supporter signals (gitignored, private)
- S3 at `s3://files.thingelstad.com/weekly-thing/issues/{n}/` — only artifacts that feed the published newsletter (Patty's CTA, Marky's subject lines, drafts that Shortcuts pulls)

If it goes into the newsletter or is read by Shortcuts, it goes to S3. Everything else stays in SQLite.

## Build order

1. Buttondown content sync first (`pipeline/buttondown/`, `content/buttondown/automations/`, `content/buttondown/newsletter/`).
2. Then Eddy end-to-end — single agent, real draft, real S3 path.
3. Then add Linky, Marky, Patty.
