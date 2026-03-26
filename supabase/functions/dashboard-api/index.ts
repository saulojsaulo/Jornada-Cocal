import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Env");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let debugTag = "start";

    if (req.method === "POST") {
      const { action, payload } = await req.json();
      if (action === "upsert_override") {
        const { data, error } = await supabase.from("macro_overrides").upsert(payload).select().single();
        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (action === "delete_override") {
        const { id } = payload;
        const { error } = await supabase.from("macro_overrides").delete().eq("id", id);
        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "Action not supported" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ROBUST DATE PARSING
    const url = new URL(req.url);
    const daysRaw = url.searchParams.get("days");
    const daysWindow = daysRaw ? parseInt(daysRaw) : 2;
    const finalDays = isNaN(daysWindow) ? 2 : daysWindow;

    const startParam = url.searchParams.get("start");
    let start: Date;
    if (startParam && startParam !== "null" && startParam !== "undefined") {
      start = new Date(startParam);
    } else {
      start = new Date();
      start.setDate(start.getDate() - finalDays);
    }
    if (isNaN(start.getTime())) {
       start = new Date();
       start.setDate(start.getDate() - finalDays);
    }

    const endParam = url.searchParams.get("end");
    let end = (endParam && endParam !== "null") ? new Date(endParam) : new Date();
    if (isNaN(end.getTime())) end = new Date();

    const startIso = start.toISOString();
    const endIso = end.toISOString();
    const driverSenha = url.searchParams.get("driverSenha");

    console.log(`[GET] ${startIso} to ${endIso}`);

    // Sequential Fetch
    debugTag = "fetch_vehicles";
    const { data: vehicles } = await supabase.from("autotrac_vehicles").select("id, vehicle_code, name, plate, account_number").order("name");
    
    debugTag = "fetch_cadastros";
    const { data: cadastros } = await supabase.from("cadastros").select("id, veiculo_id, motorista_nome, gestor_nome, numero_frota").eq("ativo", true);
    
    debugTag = "fetch_motoristas";
    const { data: motoristas } = await supabase.from("motoristas").select("id, nome, senha");

    debugTag = "fetch_events";
    let eventQuery = supabase.from("autotrac_eventos")
      .select("id, vehicle_code, macro_number, message_time, landmark, latitude, longitude, driver_password") // REMOVED raw_data (too heavy)
      .gte("message_time", startIso)
      .lte("message_time", endIso)
      .order("message_time", { ascending: false }) // NEWEST FIRST
      .limit(5000); // Safe limit for Edge Functions memory

    if (driverSenha) {
      eventQuery = eventQuery.or(`driver_password.eq.${driverSenha},raw_data->>MessageText.ilike.%_${driverSenha}%`);
    }
    const { data: rawEvents } = await eventQuery;

    debugTag = "fetch_positions";
    const { data: positions } = await supabase.from("autotrac_posicoes").select("vehicle_code, landmark, latitude, longitude, position_time");

    debugTag = "fetch_overrides";
    const { data: overrides } = await supabase.from("macro_overrides").select("*").gte("event_time", startIso).lte("event_time", endIso);

    debugTag = "fetch_telemetry";
    let telemetry: any[] = [];
    const vehicleCodes = (vehicles || []).map(v => v.vehicle_code);
    if (vehicleCodes.length > 0) {
      const { data: telData } = await supabase
        .from("telemetria_sync")
        .select("*")
        .in("vehicle_code", vehicleCodes)
        .gte("data_jornada", startIso.split("T")[0])
        .lte("data_jornada", endIso.split("T")[0]);
      telemetry = telData || [];
    }

    // Process data: Sort events back to ASC for frontend timeline logic
    const events = (rawEvents || [])
      .map(e => {
        const driver = e.driver_password ? driverBySenha.get(e.driver_password) : null;
        return { ...e, driver_id: driver?.id || null, driver_name: driver?.nome || null };
      })
      .sort((a, b) => new Date(a.message_time).getTime() - new Date(b.message_time).getTime());

    debugTag = "success_response";
    return new Response(JSON.stringify({
      success: true,
      vehicles: vehicles || [],
      cadastros: cadastros || [],
      motoristas: motoristas || [],
      events,
      positions: positions || [],
      overrides: overrides || [],
      telemetry: telemetry || [],
      syncedAt: new Date().toISOString()
    }), {
      headers: { 
        ...corsHeaders, 
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0" // Force no-cache
      }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message, tag: debugTag }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
