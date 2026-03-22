
CREATE TABLE public.telemetria_sync (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_code integer NOT NULL,
  veiculo_id text,
  data_jornada date NOT NULL,
  pontos jsonb NOT NULL DEFAULT '[]'::jsonb,
  distancia_km numeric DEFAULT 0,
  total_raw integer DEFAULT 0,
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(vehicle_code, data_jornada)
);

ALTER TABLE public.telemetria_sync ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read telemetria_sync" ON public.telemetria_sync
  FOR SELECT TO anon USING (true);

CREATE POLICY "Allow service insert telemetria_sync" ON public.telemetria_sync
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Allow service update telemetria_sync" ON public.telemetria_sync
  FOR UPDATE TO service_role USING (true);

CREATE POLICY "Allow service delete telemetria_sync" ON public.telemetria_sync
  FOR DELETE TO service_role USING (true);
