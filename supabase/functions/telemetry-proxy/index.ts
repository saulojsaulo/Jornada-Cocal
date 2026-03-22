import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXTERNAL_SUPABASE_URL = "https://vpewwefakpdyivroelxl.supabase.co";
const EXTERNAL_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZwZXd3ZWZha3BkeWl2cm9lbHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMjc3NTksImV4cCI6MjA4ODgwMzc1OX0.ufSG5qjkMCkgLVv_Aw6z5Z_rA4pz1NDd9bz0JSEI9t0";

interface Payload {
  date: string;
  vehicleCodes: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as Payload;
    const date = String(body?.date ?? "").trim();
    const vehicleCodes = Array.from(new Set((body?.vehicleCodes ?? []).map((c) => String(c ?? "").trim()).filter(Boolean)));

    if (!date) {
      return new Response(JSON.stringify({ success: false, error: "date is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (vehicleCodes.length === 0) {
      return new Response(JSON.stringify({ success: true, rows: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ext = createClient(EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_ANON_KEY);

    for (const code of vehicleCodes) {
      const { data, error } = await ext
        .from("telemetria_veiculos")
        .select("pontos")
        .eq("vehicle_code", code)
        .eq("data_jornada", date);

      if (error) {
        console.error("telemetry query error", { code, error: error.message });
        continue;
      }

      if (Array.isArray(data) && data.length > 0) {
        return new Response(JSON.stringify({ success: true, rows: data, matchedCode: code }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ success: true, rows: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
