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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

    // --- NEW HIGH-PERFORMANCE LOGIC: Use dashboard_resumo ---
    debugTag = "fetch_resumo";
    const { data: resumo, error: rErr } = await supabase
      .from("dashboard_resumo")
      .select("*")
      .order("updated_at", { ascending: false });
    
    if (rErr) throw rErr;

    // We still fetch vehicles for metadata if needed
    debugTag = "fetch_vehicles";
    const { data: vehicles } = await supabase.from("autotrac_vehicles").select("id, vehicle_code, name, plate, account_number").order("name");
    
    // Fetch overrides for the window
    debugTag = "fetch_overrides";
    const { data: overrides } = await supabase.from("macro_overrides").select("*").gte("event_time", startIso).lte("event_time", endIso);

    // Fetch positions separately to ensure most recent (if needed, but resume has it)
    debugTag = "fetch_positions";
    const { data: positions } = await supabase.from("autotrac_posicoes").select("vehicle_code, landmark, latitude, longitude, position_time");

    // Fetch telemetry summary
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

    // Since the frontend expects "events" for the timeline, we still need some events
    // BUT we fetch them PAGINATED or limited to a very small amount for "latest activity"
    debugTag = "fetch_recent_events";
    const { data: recentEvents } = await supabase
      .from("autotrac_eventos")
      .select("id, vehicle_code, macro_number, message_time, landmark, latitude, longitude, driver_password")
      .gte("message_time", startIso)
      .lte("message_time", endIso)
      .order("message_time", { ascending: false })
      .limit(1000); // 1,000 is safe and enough for "recent" view

    // Fetch cadastros and motoristas for metadata
    debugTag = "fetch_cadastros";
    const { data: cadastros } = await supabase.from("cadastros").select("*");
    debugTag = "fetch_motoristas";
    const { data: motoristas } = await supabase.from("motoristas").select("*");

    return new Response(JSON.stringify({
      success: true,
      resumo: resumo || [],
      vehicles: vehicles || [],
      cadastros: cadastros || [],
      motoristas: motoristas || [],
      events: recentEvents || [],
      positions: positions || [],
      overrides: overrides || [],
      telemetry: telemetry || [],
      syncedAt: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
