import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Handle POST requests early to avoid unnecessary work
    if (req.method === "POST") {
      const { action, payload } = await req.json();
      console.log(`[API] POST Action: ${action}`);

      if (action === "upsert_override") {
        const { data, error } = await supabase.from("macro_overrides").insert(payload).select().single();
        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "delete_override") {
        const { id } = payload;
        const { error } = await supabase.from("macro_overrides").delete().eq("id", id);
        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      
      throw new Error(`Action ${action} not supported`);
    }

    const url = new URL(req.url);
    const daysWindow = parseInt(url.searchParams.get("days") || "2");
    const startDateParam = url.searchParams.get("start");
    const endDateParam = url.searchParams.get("end");
    const driverSenha = url.searchParams.get("driverSenha");
    
    let start: Date;
    let end: Date = new Date();

    if (startDateParam && startDateParam !== "null" && startDateParam !== "undefined") {
      start = new Date(startDateParam);
    } else {
      start = new Date();
      start.setDate(start.getDate() - daysWindow);
    }

    if (endDateParam && endDateParam !== "null" && endDateParam !== "undefined") {
      end = new Date(endDateParam);
    }

    // Safety check for invalid dates
    if (isNaN(start.getTime())) {
      start = new Date();
      start.setDate(start.getDate() - daysWindow);
    }
    if (isNaN(end.getTime())) {
      end = new Date();
    }

    console.log(`Fetching data from ${start.toISOString()} to ${end.toISOString()} (Driver: ${driverSenha || 'All'})`);

    // Build event query
    let eventQuery = supabase.from("autotrac_eventos")
      .select("id, vehicle_code, macro_number, message_time, landmark, latitude, longitude, driver_password, raw_data")
      .gte("message_time", start.toISOString())
      .lte("message_time", end.toISOString())
      .order("message_time", { ascending: true })
      .limit(10000);

    if (driverSenha) {
      eventQuery = eventQuery.or(`driver_password.eq.${driverSenha},raw_data->>MessageText.ilike.%_${driverSenha}%`);
    }

    // Fetch data in parallel
    const [
      { data: vehicles },
      { data: cadastros },
      { data: motoristas },
      { data: rawEvents },
      { data: positions },
      { data: overrides }
    ] = await Promise.all([
      supabase.from("autotrac_vehicles").select("id, vehicle_code, name, plate, account_number").order("name"),
      supabase.from("cadastros").select("id, veiculo_id, motorista_nome, gestor_nome, numero_frota").eq("ativo", true),
      supabase.from("motoristas").select("id, nome, senha"),
      eventQuery,
      supabase.from("autotrac_positions").select("vehicle_code, landmark, latitude, longitude, position_time"),
      supabase.from("macro_overrides")
        .select("id, vehicle_code, original_event_id, action, macro_number, event_time, reason")
        .gte("event_time", start.toISOString())
        .lte("event_time", end.toISOString())
        .order("created_at", { ascending: false })
        .limit(2000)
    ]);

    // Map driver names to events on the server side
    const driverBySenha = new Map<string, { id: string; nome: string }>();
    if (motoristas) {
      for (const m of motoristas) {
        if (m.senha) driverBySenha.set(m.senha, { id: m.id, nome: m.nome });
      }
    }

    const events = (rawEvents || []).map(e => {
      const driver = e.driver_password ? driverBySenha.get(e.driver_password) : null;
      return {
        ...e,
        driver_id: driver?.id || null,
        driver_name: driver?.nome || null
      };
    });

    // Fetch telemetry for the retrieved vehicles
    let telemetry: any[] = [];
    const codes = (vehicles || []).map((v: any) => v.vehicle_code);
    
    if (codes.length > 0) {
      const startStr = start.toISOString().split("T")[0];
      const endStr = end.toISOString().split("T")[0];
      
      const { data: telData } = await supabase
        .from("telemetria_sync")
        .select("*")
        .in("vehicle_code", codes)
        .gte("data_jornada", startStr)
        .lte("data_jornada", endStr);
      telemetry = telData || [];
    }

    const result = {
      vehicles: vehicles || [],
      cadastros: cadastros || [],
      motoristas: motoristas || [],
      events: events || [],
      positions: positions || [],
      overrides: overrides || [],
      telemetry: telemetry,
      syncedAt: new Date().toISOString()
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Dashboard API error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
