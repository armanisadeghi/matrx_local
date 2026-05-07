# Agent Tasks

Active worklist managed by agents. **See `AGENT_INSTRUCTIONS.md` for rules** — especially around task format, condensation, and when to ask the user.

> Quick scan order for arriving agents:
> 1. **Needs Clarification** below (questions waiting on the user)
> 2. **Blocked** (waiting on external)
> 3. **Active** (`ready` and `in-progress`)
> 4. **Completed** (recent context, condensed)

---

## Needs Clarification

_(none)_

## Blocked

_(none)_

## Active

_(none)_

---

## Completed

- [ENH] /extension/* JWT validation: real Supabase HS256 signature + expiry check via new app/api/extension_auth.py. Loopback fallback preserved when SUPABASE_JWT_SECRET unset (loud WARNING). 2026-05-07 (commit-sha)
