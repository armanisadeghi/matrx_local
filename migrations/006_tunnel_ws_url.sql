-- ============================================================================
-- Matrx Local: Add tunnel_ws_url to app_instances
-- ============================================================================
-- The tunnel_url column stores the HTTPS REST endpoint for the Cloudflare
-- tunnel. This migration adds tunnel_ws_url to store the WSS WebSocket
-- endpoint (tunnel_url with https:// → wss:// and /ws appended) so remote
-- clients can connect to both REST and WebSocket without computing the URL
-- themselves.
--
-- Both URLs change on every quick-tunnel restart. The heartbeat (every 5
-- minutes) and the tunnel start/stop API calls both write these columns so
-- remote clients always have the current value.
-- ============================================================================

ALTER TABLE public.app_instances
    ADD COLUMN IF NOT EXISTS tunnel_ws_url TEXT;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
