import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.jornadademotorista.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

Deno.serve(async (req) => {
  // 1. Handle Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 2. Wrap EVERYTHING in Try/Catch to ensure CORS is ALWAYS returned
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let debugTag = "start";

    // Handle POST (Mutations)
    if (req.method === "POST") {
      debugTag = "post_action";
      const { action, payload } = await req.json();
      console.log(`[API] POST Action: ${action}`);

      if (action === "upsert_override") {
        const { data, error } = await supabase.from("macro_overrides").insert(payload).select().single();
        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data }), { 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }

      if (action === "delete_override") {
        const { id } = payload;
        const { error } = await supabase.from("macro_overrides").delete().eq("id", id);
        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), { 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }
      throw new Error(`Action ${action} not supported`);
    }

    // Handle GET (Data Fetching)
    debugTag = "parse_query_params";
    const url = new URL(req.url);
    const daysWindow = parseInt(url.searchParams.get("days") || "2");
    const startDateParam = url.searchParams.get("start");
    const endDateParam = url.searchParams.get("end");
    const driverSenha = url.searchParams.get("driverSenha");
    
    let start: Date;
    let end: Date = new Date();

    if (startDateParam && startDateParam !== "null" && startDateParam !== "undefined" && startDateParam !== "") {
      start = new Date(startDateParam);
    } else {
      start = new Date();
      start.setDate(start.getDate() - daysWindow);
    }

    if (endDateParam && endDateParam !== "null" && endDateParam !== "undefined" && endDateParam !== "") {
      end = new Date(endDateParam);
    }
    
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    console.log(`[${debugTag}] Query range: ${startIso} to ${endIso}`);

    // Fetch data sequentially to avoid heavy DB load causing timeouts
    debugTag = "fetch_vehicles";
    const { data: vehicles, error: vErr } = await supabase
      .from("autotrac_vehicles").select("id, vehicle_code, name, plate, account_number").order("name");
    if (vErr) throw vErr;

    debugTag = "fetch_cadastros";
    const { data: cadastros, error: cErr } = await supabase
      .from("cadastros").select("id, veiculo_id, motorista_nome, gestor_nome, numero_frota").eq("ativo", true);
    if (cErr) throw cErr;

    debugTag = "fetch_motoristas";
    const { data: motoristas, error: mErr } = await supabase
      .from("motoristas").select("id, nome, senha");
    if (mErr) throw mErr;

    debugTag = "fetch_events";
    let eventQuery = supabase.from("autotrac_eventos")
      .select("id, vehicle_code, macro_number, message_time, landmark, latitude, longitude, driver_password, raw_data")
      .gte("message_time", startIso)
      .lte("message_time", endIso)
      .order("message_time", { ascending: true })
      .limit(3000); // Further reduced limit for stability

    if (driverSenha && driverSenha.trim() !== "") {
      eventQuery = eventQuery.or(`driver_password.eq.${driverSenha},raw_data->>MessageText.ilike.%_${driverSenha}%`);
    }
    const { data: rawEvents, error: eErr } = await eventQuery;
    if (eErr) throw eErr;

    debugTag = "fetch_positions";
    const { data: positions, error: pErr } = await supabase
      .from("autotrac_posicoes").select("vehicle_code, landmark, latitude, longitude, position_time");
    if (pErr) throw pErr;

    debugTag = "fetch_overrides";
    const { data: overrides, error: oErr } = await supabase
      .from("macro_overrides")
      .select("id, vehicle_code, original_event_id, action, macro_number, event_time, reason")
      .gte("event_time", startIso)
      .lte("event_time", endIso)
      .order("created_at", { ascending: false });
    if (oErr) throw oErr;

    debugTag = "process_data";
    // Driver mapping
    const driverBySenha = new Map<string, { id: string; nome: string }>();
    if (motoristas) {
      motoristas.forEach(m => {
        if (m.senha) driverBySenha.set(m.senha, { id: m.id, nome: m.nome });
      });
    }

    const events = (rawEvents || []).map(e => {
      const driver = e.driver_password ? driverBySenha.get(e.driver_password) : null;
      return { ...e, driver_id: driver?.id || null, driver_name: driver?.nome || null };
    });

    // Telemetry fetch (if vehicles exist)
    debugTag = "fetch_telemetry";
    let telemetry: any[] = [];
    const vehicleCodes = (vehicles || []).map(v => v.vehicle_code);
    if (vehicleCodes.length > 0) {
      const { data: telData, error: tErr } = await supabase
        .from("telemetria_sync")
        .select("*")
        .in("vehicle_code", vehicleCodes)
        .gte("data_jornada", startIso.split("T")[0])
        .lte("data_jornada", endIso.split("T")[0]);
      if (tErr) throw tErr;
      telemetry = telData || [];
    }

    debugTag = "success_response";
    return new Response(JSON.stringify({
      success: true,
      vehicles: vehicles || [],
      cadastros: cadastros || [],
      motoristas: motoristas || [],
      events: events || [],
      positions: positions || [],
      overrides: overrides || [],
      telemetry: telemetry,
      syncedAt: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error(`[API ERROR] Tag: ${debugTag}`, err);
    return new Response(JSON.stringify({
      success: false,
      error: err.message || "Internal Server Error",
      tag: debugTag,
      timestamp: new Date().toISOString()
    }), {
      status: 200, // Important: 200 to bypass CORS swallow on 500
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
