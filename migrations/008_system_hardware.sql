-- ============================================================================
-- Matrx Local: System Hardware Profile
-- ============================================================================
-- Adds a system_hardware JSONB column to app_instances to store the full
-- hardware inventory collected on each device:
--   • CPUs (model, cores, threads, frequency, architecture)
--   • GPUs (name, VRAM, driver, backend — CUDA/Vulkan/Metal)
--   • RAM (total, available, type, speed when available)
--   • Audio input devices (microphones)
--   • Audio output devices (speakers/headphones)
--   • Video capture devices (webcams, capture cards)
--   • Monitors (name, resolution, refresh rate)
--   • Network adapters (name, type, MAC, IP, connected)
--   • Storage devices (name, total, free, type, mountpoint)
--
-- Using a single JSONB column rather than 30+ individual columns so we can
-- extend the schema without further migrations as new hardware categories
-- are added. The column is nullable — populated only after first detection.
-- ============================================================================

ALTER TABLE public.app_instances
    ADD COLUMN IF NOT EXISTS system_hardware jsonb,
    ADD COLUMN IF NOT EXISTS hardware_detected_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_app_instances_hardware_detected_at
    ON public.app_instances(hardware_detected_at)
    WHERE hardware_detected_at IS NOT NULL;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
