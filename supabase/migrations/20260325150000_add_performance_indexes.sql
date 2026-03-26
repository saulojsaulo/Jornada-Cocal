-- Migration: Add performance indexes for Driver Journey System
-- Target: autotrac_eventos, macro_overrides, telemetria_sync

-- Index for driver-centric history discovery (the main bottleneck)
CREATE INDEX IF NOT EXISTS idx_eventos_driver_password ON public.autotrac_eventos ((raw_data->>'MessageText'));

-- Index for vehicle_code and message_time range queries
CREATE INDEX IF NOT EXISTS idx_eventos_vehicle_time ON public.autotrac_eventos (vehicle_code, message_time);

-- Index for overrides by vehicle and time
CREATE INDEX IF NOT EXISTS idx_overrides_vehicle_time ON public.macro_overrides (vehicle_code, event_time);

-- Index for telemetry lookup
CREATE INDEX IF NOT EXISTS idx_telemetria_vehicle_date ON public.telemetria_sync (vehicle_code, data_jornada);

-- VACUUM ANALYZE to update statistics
-- Note: In Supabase, this is usually handled by autovacuum, but for large migrations it helps.
-- VACUUM ANALYZE public.autotrac_eventos;
