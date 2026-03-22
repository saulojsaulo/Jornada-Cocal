
-- Table to store vehicles synced from Autotrac API
CREATE TABLE public.autotrac_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_code integer NOT NULL UNIQUE,
  account_code integer NOT NULL,
  name text NOT NULL,
  vehicle_address integer,
  plate text,
  account_number text,
  family_description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Table to store macro events from return messages
CREATE TABLE public.autotrac_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autotrac_id integer,
  vehicle_code integer NOT NULL,
  account_number integer,
  macro_number integer NOT NULL,
  macro_version integer,
  message_time timestamptz NOT NULL,
  latitude numeric,
  longitude numeric,
  landmark text,
  ignition integer,
  position_time timestamptz,
  vehicle_address integer,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(vehicle_code, macro_number, message_time)
);

-- Table to store latest vehicle positions
CREATE TABLE public.autotrac_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_code integer NOT NULL UNIQUE,
  latitude numeric,
  longitude numeric,
  landmark text,
  speed integer,
  ignition integer,
  position_time timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.autotrac_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autotrac_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autotrac_positions ENABLE ROW LEVEL SECURITY;

-- Public read policies (no auth required for this internal tool)
CREATE POLICY "Allow public read autotrac_vehicles" ON public.autotrac_vehicles FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public read autotrac_eventos" ON public.autotrac_eventos FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public read autotrac_positions" ON public.autotrac_positions FOR SELECT TO anon USING (true);

-- Service role insert/update (edge function uses service role)
CREATE POLICY "Allow service insert autotrac_vehicles" ON public.autotrac_vehicles FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Allow service update autotrac_vehicles" ON public.autotrac_vehicles FOR UPDATE TO service_role USING (true);
CREATE POLICY "Allow service insert autotrac_eventos" ON public.autotrac_eventos FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Allow service update autotrac_eventos" ON public.autotrac_eventos FOR UPDATE TO service_role USING (true);
CREATE POLICY "Allow service delete autotrac_eventos" ON public.autotrac_eventos FOR DELETE TO service_role USING (true);
CREATE POLICY "Allow service insert autotrac_positions" ON public.autotrac_positions FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Allow service update autotrac_positions" ON public.autotrac_positions FOR UPDATE TO service_role USING (true);

-- Index for faster event queries
CREATE INDEX idx_autotrac_eventos_vehicle_time ON public.autotrac_eventos(vehicle_code, message_time DESC);
CREATE INDEX idx_autotrac_eventos_message_time ON public.autotrac_eventos(message_time DESC);
