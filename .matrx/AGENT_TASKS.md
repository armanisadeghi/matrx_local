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

- [ENH] Boot self-check: every engine startup verifies /extension/* routes registered + JWT posture + tunnel/metrics/discovery, logs summary, GET/POST /extension/boot-check endpoints + Bridge Test panel. 2026-05-07 (commit-sha)
- [ENH] /extension/tunnel/status: runtime introspection of Cloudflare tunnel state with preferred-mode logic (MATRX_PREFER_TUNNEL); Bridge Test sub-panel surfaces it with re-pair hint when engine prefers tunnel. 2026-05-07 (82fdce6a)
- [ENH] /extension/* observability: in-memory metrics (count, errors, last-N latencies) per command via app/api/extension_metrics.py + GET /extension/metrics + Metrics panel in Bridge Test. 2026-05-07 (648a17e1)
- [ENH] /extension/* JWT validation: real Supabase JWKS (preferred) + HS256 (fallback) signature + expiry check via new app/api/extension_auth.py. Loopback fallback preserved when SUPABASE_JWT_SECRET and SUPABASE_URL both unset (loud one-time WARNING). 2026-05-07 (61a26f7b)
