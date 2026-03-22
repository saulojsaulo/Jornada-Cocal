CREATE TABLE public.cadastros (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  veiculo_id TEXT NOT NULL,
  nome_veiculo TEXT NOT NULL,
  numero_frota TEXT NOT NULL,
  placa TEXT DEFAULT '',
  motorista_id TEXT DEFAULT NULL,
  motorista_nome TEXT DEFAULT NULL,
  gestor_id TEXT DEFAULT NULL,
  gestor_nome TEXT DEFAULT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(veiculo_id)
);

ALTER TABLE public.cadastros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read cadastros" ON public.cadastros FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public insert cadastros" ON public.cadastros FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow public update cadastros" ON public.cadastros FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete cadastros" ON public.cadastros FOR DELETE TO anon USING (true);