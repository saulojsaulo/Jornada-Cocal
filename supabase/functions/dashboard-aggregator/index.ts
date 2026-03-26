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

    console.log("Starting Aggregation Process (V3 - Robust)...");

    // 1. Fetch all active registrations
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
    const todayStr = todayStart.toISOString().split("T")[0];
    
    // Look back window for driver name discovery (3 days)
    const lookbackStart = new Date(todayStart.getTime() - 3 * 24 * 60 * 60 * 1000);

    for (const cad of cadastros) {
       // A. Fetch latest position
       const { data: pos } = await supabase
         .from("autotrac_posicoes")
         .select("landmark, position_time")
         .eq("vehicle_code", cad.veiculo_id)
         .order("position_time", { ascending: false })
         .limit(1)
         .maybeSingle();

       // B. Fetch today's events (ascending for chronological calc)
       const { data: events } = await supabase
         .from("autotrac_eventos")
         .select("macro_number, message_time, driver_name, driver_password")
         .eq("vehicle_code", cad.veiculo_id)
         .gte("message_time", todayStart.toISOString())
         .order("message_time", { ascending: true });

       const safeEvents = events || [];

       // C. Robust Journey Calculation (Net Journey)
       let totalWorkMillis = 0;
       let lastWorkStartTime: number | null = null;
       let currentStatus = "Desconhecido";
       let lastMacroNum: number | null = null;
       let lastDriverPassword: string | null = null;

       const workStartMacros = [1, 4, 6, 10];
       const pauseStartMacros = [2, 3, 5, 9];

       for (const e of safeEvents) {
         const m = e.macro_number;
         const time = new Date(e.message_time).getTime();
         if (e.driver_password) lastDriverPassword = e.driver_password;

         // Logic: if a pause or end starts, close current work period
         if (pauseStartMacros.includes(m || 0)) {
           if (lastWorkStartTime !== null) {
             totalWorkMillis += Math.max(0, time - lastWorkStartTime);
             lastWorkStartTime = null;
           }
         } 
         // Logic: if a work period starts, mark start time
         else if (workStartMacros.includes(m || 0)) {
           if (lastWorkStartTime === null) {
             lastWorkStartTime = time;
           }
         }

         if (m !== null) {
           lastMacroNum = m;
           currentStatus = MACRO_STATUS[m] || currentStatus;
         }
       }

       // If currently in journey (last status not Fim de Jornada) and in work mode, add until now
       if (lastMacroNum !== 2 && lastWorkStartTime !== null) {
         totalWorkMillis += Math.max(0, now.getTime() - lastWorkStartTime);
       }

       const hours = Math.floor(totalWorkMillis / (1000 * 60 * 60));
       const minutes = Math.floor((totalWorkMillis % (1000 * 60 * 60)) / (1000 * 60));
       const totalJornadaFormatted = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

       // D. Enhanced Driver Name Discovery
       let finalDriverName = cad.motorista_nome || null;
       
       // Fallback 1: Look at today's events (already have them)
       if (!finalDriverName) {
         const eventName = safeEvents.slice().reverse().find(e => e.driver_name)?.driver_name;
         if (eventName) finalDriverName = eventName;
       }

       // Fallback 2: Look back 3 days
       if (!finalDriverName) {
         const { data: prevEvents } = await supabase
           .from("autotrac_eventos")
           .select("driver_name, driver_password")
           .eq("vehicle_code", cad.veiculo_id)
           .gte("message_time", lookbackStart.toISOString())
           .lt("message_time", todayStart.toISOString())
           .order("message_time", { ascending: false })
           .limit(50);
         
         const prevName = prevEvents?.find(e => e.driver_name)?.driver_name;
         if (prevName) finalDriverName = prevName;
         if (!lastDriverPassword) lastDriverPassword = prevEvents?.find(e => e.driver_password)?.driver_password || null;
       }

       // Fallback 3: Check motoristas table by password
       if (!finalDriverName && lastDriverPassword) {
         const { data: mot } = await supabase
           .from("motoristas")
           .select("nome")
           .eq("senha", lastDriverPassword)
           .maybeSingle();
         if (mot?.nome) finalDriverName = mot.nome;
       }

       // E. Alert count (macros 10-13)
       const alertsCount = safeEvents.filter(e => [10, 11, 12, 13].includes(e.macro_number || 0)).length;

       summaries.push({
         vehicle_code: cad.veiculo_id,
         motorista_nome: finalDriverName || "Motorista não identificado",
         gestor_nome: cad.gestor_nome,
         status_atual: lastMacroNum ? (MACRO_STATUS[lastMacroNum] || "Desconhecido") : "Sem Dados",
         ultima_posicao_texto: pos?.landmark || "Não localizada",
         total_jornada_hoje: totalJornadaFormatted, 
         alertas_count: alertsCount,
         data_referencia: todayStr,
         updated_at: new Date().toISOString()
       });
    }

    // 5. Upsert all summaries
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
