import { createClient } from "@supabase/supabase-js";

const EXTERNAL_SUPABASE_URL = "https://vpewwefakpdyivroelxl.supabase.co";
const EXTERNAL_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZwZXd3ZWZha3BkeWl2cm9lbHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMjc3NTksImV4cCI6MjA4ODgwMzc1OX0.ufSG5qjkMCkgLVv_Aw6z5Z_rA4pz1NDd9bz0JSEI9t0";

export const externalSupabase = createClient(EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_ANON_KEY);

export interface ExternalMotorista {
  id: string;
  nome: string;
  cpf: string | null;
  telefone: string | null;
  ativo: boolean;
}
