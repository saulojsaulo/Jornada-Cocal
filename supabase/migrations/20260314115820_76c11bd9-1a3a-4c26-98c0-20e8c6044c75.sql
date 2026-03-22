
-- Table to store manual macro overrides (edits, inserts, deletes)
-- Original events remain in autotrac_eventos for audit trail
CREATE TABLE public.macro_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_code integer NOT NULL,
  original_event_id text,
  action text NOT NULL CHECK (action IN ('insert', 'edit', 'delete')),
  macro_number integer,
  event_time timestamptz,
  original_macro_number integer,
  original_event_time timestamptz,
  reason text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.macro_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read macro_overrides" ON public.macro_overrides
FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert macro_overrides" ON public.macro_overrides
FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update macro_overrides" ON public.macro_overrides
FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated delete macro_overrides" ON public.macro_overrides
FOR DELETE TO authenticated USING (true);
