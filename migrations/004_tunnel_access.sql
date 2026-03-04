-- ============================================================================
-- Matrx Local: Tunnel Access Columns
-- ============================================================================
-- Adds remote tunnel URL tracking to app_instances so mobile/web clients
-- can discover which PC has an active Cloudflare tunnel and connect to it.
--
-- Already applied to automation-matrix Supabase project (txzxabzwovsujtloxrus).
-- This file is kept for reference and reproducibility.
-- ============================================================================

ALTER TABLE public.app_instances
  ADD COLUMN IF NOT EXISTS tunnel_url TEXT,
  ADD COLUMN IF NOT EXISTS tunnel_active BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tunnel_updated_at TIMESTAMPTZ;

-- Partial index — only rows with an active tunnel are indexed, keeping it tiny.
CREATE INDEX IF NOT EXISTS idx_app_instances_tunnel_active
  ON public.app_instances(user_id, tunnel_active)
  WHERE tunnel_active = TRUE;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
