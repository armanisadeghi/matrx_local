-- ============================================================================
-- Matrx Local: Clean up duplicate RLS policies + stale tunnel auto-expiry
-- ============================================================================
--
-- 1. Remove duplicate RLS policies that were created by two migration runs.
--    Each table ended up with two identical policies. One is enough.
--
-- 2. Add a database function + cron job that auto-expires tunnel_active=true
--    rows where last_seen is older than 15 minutes. This ensures that if an
--    engine crashes or is killed (SIGKILL, power loss) without running cleanup,
--    remote clients won't keep trying a dead tunnel URL indefinitely.
--    The heartbeat runs every 5 minutes — 3 missed heartbeats = stale tunnel.
-- ============================================================================

-- ── 1. Remove duplicate policies ─────────────────────────────────────────────

DROP POLICY IF EXISTS app_instances_owner ON public.app_instances;
DROP POLICY IF EXISTS app_settings_owner  ON public.app_settings;
DROP POLICY IF EXISTS app_sync_status_owner ON public.app_sync_status;

-- The "Users manage own *" policies remain as the single authoritative policy.
-- Verify:
--   SELECT policyname FROM pg_policies WHERE tablename IN
--   ('app_instances','app_settings','app_sync_status');

-- ── 2. Stale tunnel auto-expiry ───────────────────────────────────────────────
--
-- Function: expire_stale_tunnels()
--   Sets tunnel_active=false, tunnel_url=null, tunnel_ws_url=null for any
--   instance whose last_seen is older than 15 minutes AND tunnel_active=true.
--   Called by the pg_cron job below.

CREATE OR REPLACE FUNCTION public.expire_stale_tunnels()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.app_instances
    SET
        tunnel_active     = FALSE,
        tunnel_url        = NULL,
        tunnel_ws_url     = NULL,
        tunnel_updated_at = now()
    WHERE
        tunnel_active = TRUE
        AND last_seen < (now() - INTERVAL '15 minutes');
END;
$$;

-- Grant execute to postgres role only (runs as SECURITY DEFINER, not as user).
REVOKE ALL ON FUNCTION public.expire_stale_tunnels() FROM PUBLIC;

-- ── 3. Schedule the expiry function via pg_cron ───────────────────────────────
--
-- pg_cron is enabled on all Supabase projects.
-- Run every 5 minutes so a crashed engine's tunnel is cleared within 20 min max
-- (15 min grace + up to 5 min until next cron tick).

SELECT cron.schedule(
    'expire-stale-tunnels',          -- job name (idempotent: replaces if exists)
    '*/5 * * * *',                   -- every 5 minutes
    'SELECT public.expire_stale_tunnels();'
);

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
