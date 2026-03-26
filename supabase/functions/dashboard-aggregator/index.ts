import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Map of status based on macro number
const MACRO_STATUS: Record<number, string> = {
  1: "Em Jornada",
  2: "Fim de Jornada",
  3: "Início Refeição",
  4: "Fim Refeição",
  5: "Início Repouso",
  6: "Fim Repouso",
  7: "Início Espera",
  8: "Fim Espera",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log("Starting Aggregation Process...");

    // 1. Fetch all active registrations (vehicles + drivers)
    const { data: cadastros, error: cErr } = await supabase
      .from("cadastros")
      .select("veiculo_id, numero_frota, motorista_nome, gestor_nome")
      .eq("ativo", true);
    
    if (cErr) throw cErr;
    console.log(`Processing ${cadastros.length} registrations`);

    const summaries = [];
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    for (const cad of cadastros) {
       // Fetch latest position
       const { data: pos } = await supabase
         .from("autotrac_posicoes")
         .select("landmark, position_time")
         .eq("vehicle_code", cad.numero_frota)
         .maybeSingle();

       // Fetch latest significant macro (Status)
       const { data: lastMacro } = await supabase
         .from("autotrac_eventos")
         .select("macro_number, message_time")
         .eq("vehicle_code", cad.numero_frota)
         .order("message_time", { ascending: false })
         .limit(1)
         .maybeSingle();

       // Fetch total events today for alert counting/status
       const { count: alertsCount } = await supabase
         .from("autotrac_eventos")
         .select("id", { count: "exact", head: true })
         .eq("vehicle_code", cad.numero_frota)
         .gte("message_time", todayStart.toISOString())
         .in("macro_number", [10, 11, 12, 13]); // Example alert macros

       const status = lastMacro ? (MACRO_STATUS[lastMacro.macro_number] || "Desconhecido") : "Sem Dados";
       
       summaries.push({
         vehicle_code: cad.numero_frota,
         motorista_nome: cad.motorista_nome,
         gestor_nome: cad.gestor_nome,
         status_atual: status,
         ultima_posicao_texto: pos?.landmark || "Não localizada",
         total_jornada_hoje: "00:00", // Will be calculated in future enhancement
         alertas_count: alertsCount || 0,
         data_referencia: todayStart.toISOString().split("T")[0],
         updated_at: new Date().toISOString()
       });
    }

    // Upsert all summaries
    if (summaries.length > 0) {
      const { error: upsertErr } = await supabase
        .from("dashboard_resumo")
        .upsert(summaries, { onConflict: "vehicle_code" });
      
      if (upsertErr) throw upsertErr;
    }

    return new Response(JSON.stringify({ 
      success: true, 
      processed: summaries.length,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Aggregation Error:", err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
