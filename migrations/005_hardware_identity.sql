-- ============================================================================
-- Matrx Local: Add hardware identity columns to app_instances
-- ============================================================================
-- Adds serial_number, hardware_uuid, and board_id columns so the cloud can
-- distinguish devices by their true hardware identity, not just hostname.
--
-- hardware_uuid  — IOPlatformUUID (macOS) / product_uuid (Linux) / csproduct UUID (Windows)
-- serial_number  — IOPlatformSerialNumber (macOS) / BIOS serial (Linux/Windows)
-- board_id       — board-id (macOS) / baseboard product name (Windows)
-- ============================================================================

ALTER TABLE public.app_instances
    ADD COLUMN IF NOT EXISTS hardware_uuid  text,
    ADD COLUMN IF NOT EXISTS serial_number  text,
    ADD COLUMN IF NOT EXISTS board_id       text;

CREATE INDEX IF NOT EXISTS idx_app_instances_hardware_uuid
    ON public.app_instances(hardware_uuid)
    WHERE hardware_uuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_instances_serial_number
    ON public.app_instances(serial_number)
    WHERE serial_number IS NOT NULL;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
