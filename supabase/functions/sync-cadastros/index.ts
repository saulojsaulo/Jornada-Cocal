import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EXTERNAL_SUPABASE_URL = "https://vpewwefakpdyivroelxl.supabase.co";
const EXTERNAL_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZwZXd3ZWZha3BkeWl2cm9lbHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMjc3NTksImV4cCI6MjA4ODgwMzc1OX0.ufSG5qjkMCkgLVv_Aw6z5Z_rA4pz1NDd9bz0JSEI9t0";

// Direct REST fetch with timeout (the supabase-js client hangs on slow DBs)
async function fetchExternal(table: string, select: string, filter: Record<string, string> = {}): Promise<any[]> {
  const params = new URLSearchParams({ select, ...filter, order: "nome.asc" });
  const url = `${EXTERNAL_SUPABASE_URL}/rest/v1/${table}?${params}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50000);
  try {
    const resp = await fetch(url, {
      headers: {
        apikey: EXTERNAL_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${EXTERNAL_SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    clearTimeout(timer);
    console.error(`Failed to fetch ${table}:`, err);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const local = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch from external DB using direct REST (avoids supabase-js hanging)
    const [extMotoristas, extGestores] = await Promise.all([
      fetchExternal("motoristas", "id,nome,cpf,telefone,ativo", { ativo: "eq.true" }),
      fetchExternal("gestores", "id,nome,email,telefone,ativo", { ativo: "eq.true" }),
    ]);

    let motoristaSynced = 0;
    if (extMotoristas.length > 0) {
      const rows = extMotoristas.map((m: any) => ({
        external_id: m.id,
        nome: m.nome,
        cpf: m.cpf || null,
        telefone: m.telefone || null,
        ativo: true,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await local.from("motoristas").upsert(rows, { onConflict: "external_id" });
      if (error) console.error("Motoristas upsert error:", error.message);
      else motoristaSynced = rows.length;
    }

    let gestorSynced = 0;
    if (extGestores.length > 0) {
      const rows = extGestores.map((g: any) => ({
        external_id: g.id,
        nome: g.nome,
        email: g.email || null,
        telefone: g.telefone || null,
        ativo: true,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await local.from("gestores").upsert(rows, { onConflict: "external_id" });
      if (error) console.error("Gestores upsert error:", error.message);
      else gestorSynced = rows.length;
    }

    return new Response(
      JSON.stringify({ success: true, motoristas: motoristaSynced, gestores: gestorSynced }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
