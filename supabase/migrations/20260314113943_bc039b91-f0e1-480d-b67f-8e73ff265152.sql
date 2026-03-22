
CREATE POLICY "Allow authenticated read cadastros" ON public.cadastros FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert cadastros" ON public.cadastros FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update cadastros" ON public.cadastros FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated delete cadastros" ON public.cadastros FOR DELETE TO authenticated USING (true);

CREATE POLICY "Allow authenticated read autotrac_eventos" ON public.autotrac_eventos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read autotrac_positions" ON public.autotrac_positions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read autotrac_vehicles" ON public.autotrac_vehicles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read telemetria_sync" ON public.telemetria_sync FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated read gestores" ON public.gestores FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert gestores" ON public.gestores FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update gestores" ON public.gestores FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated delete gestores" ON public.gestores FOR DELETE TO authenticated USING (true);

CREATE POLICY "Allow authenticated read motoristas" ON public.motoristas FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert motoristas" ON public.motoristas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update motoristas" ON public.motoristas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated delete motoristas" ON public.motoristas FOR DELETE TO authenticated USING (true);
