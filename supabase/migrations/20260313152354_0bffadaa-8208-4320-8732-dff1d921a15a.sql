
CREATE TABLE public.motoristas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE,
  nome text NOT NULL,
  cpf text,
  telefone text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.motoristas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read motoristas" ON public.motoristas FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public insert motoristas" ON public.motoristas FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow public update motoristas" ON public.motoristas FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete motoristas" ON public.motoristas FOR DELETE TO anon USING (true);

CREATE TABLE public.gestores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE,
  nome text NOT NULL,
  email text,
  telefone text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.gestores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read gestores" ON public.gestores FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public insert gestores" ON public.gestores FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow public update gestores" ON public.gestores FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete gestores" ON public.gestores FOR DELETE TO anon USING (true);
