import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const AUTOTRAC_BASE_URL = "https://aapi3.autotrac-online.com.br/aticapi";

interface PositionPoint {
  Latitude: number;
  Longitude: number;
  PositionTime: string;
  Speed: number;
  Ignition: number;
  Landmark?: string;
}

// Haversine distance in km
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function autotracFetch(path: string, apiKey: string, authHeader: string): Promise<any> {
  const url = `${AUTOTRAC_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Ocp-Apim-Subscription-Key": apiKey,
    Authorization: authHeader,
    Accept: "application/json",
  };

  const resp = await fetch(url, { 
    headers,
    signal: AbortSignal.timeout(30000),
  });

  if (resp.status === 429) {
    // Rate limited – wait and retry once
    await new Promise((r) => setTimeout(r, 2000));
    const retry = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30000),
    });
    if (!retry.ok) {
      const text = await retry.text();
      throw new Error(`Autotrac API retry error [${retry.status}]: ${text}`);
    }
    return retry.json();
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Autotrac API error [${resp.status}]: ${text}`);
  }

  return resp.json();
}

// Fetch all positions with pagination
async function fetchAllPositions(
  accountCode: number,
  vehicleCode: number,
  startDate: string,
  endDate: string,
  apiKey: string,
  authHeader: string
): Promise<PositionPoint[]> {
  const allPositions: PositionPoint[] = [];
  let offset = 0;
  const limit = 500;
  let hasMore = true;

  while (hasMore) {
    try {
      const data = await autotracFetch(
        `/v1/accounts/${accountCode}/vehicles/${vehicleCode}/positions?_limit=${limit}&_offset=${offset}&startDate=${startDate}&endDate=${endDate}`,
        apiKey,
        authHeader
      );
      const positions = data?.Data || data || [];
      if (!Array.isArray(positions) || positions.length === 0) {
        hasMore = false;
      } else {
        allPositions.push(...positions);
        if (positions.length < limit) {
          hasMore = false;
        } else {
          offset += limit;
        }
      }
    } catch (err) {
      console.error(`Pagination error at offset ${offset} for vehicle ${vehicleCode}:`, err);
      hasMore = false;
    }
  }

  return allPositions;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const AUTOTRAC_API_KEY = Deno.env.get("AUTOTRAC_API_KEY");
    if (!AUTOTRAC_API_KEY) throw new Error("AUTOTRAC_API_KEY not configured");

    const AUTOTRAC_USERNAME = Deno.env.get("AUTOTRAC_USERNAME");
    if (!AUTOTRAC_USERNAME) throw new Error("AUTOTRAC_USERNAME not configured");

    const AUTOTRAC_PASSWORD = Deno.env.get("AUTOTRAC_PASSWORD");
    if (!AUTOTRAC_PASSWORD) throw new Error("AUTOTRAC_PASSWORD not configured");

    const AUTOTRAC_ACCOUNT_NUMBER = Deno.env.get("AUTOTRAC_ACCOUNT_NUMBER");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const authHeader = `Basic ${btoa(`${AUTOTRAC_USERNAME}:${AUTOTRAC_PASSWORD}`)}`;

    // Parse optional body params
    let targetDate: string | null = null;
    let targetVehicleCodes: number[] = [];
    try {
      const body = await req.json();
      targetDate = body?.date ?? null;
      if (Array.isArray(body?.vehicleCodes)) {
        targetVehicleCodes = body.vehicleCodes.map(Number).filter((n: number) => !isNaN(n));
      }
    } catch {
      // No body is fine – sync all for today
    }

    // Default to today
    const today = new Date();
    const dateStr = targetDate || today.toISOString().slice(0, 10);
    const startDate = `${dateStr}T00:00:00`;
    const endDate = `${dateStr}T23:59:59`;

    // Get account code
    const accountsData = await autotracFetch("/v1/accounts", AUTOTRAC_API_KEY, authHeader);
    const accounts = accountsData?.Data || accountsData || [];
    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw new Error("No accounts found in Autotrac API");
    }

    let accountCode: number;
    if (AUTOTRAC_ACCOUNT_NUMBER) {
      const match = accounts.find(
        (a: any) => String(a.Number) === AUTOTRAC_ACCOUNT_NUMBER || String(a.Code) === AUTOTRAC_ACCOUNT_NUMBER
      );
      accountCode = match?.Code || accounts[0].Code;
    } else {
      accountCode = accounts[0].Code;
    }

    // Get vehicles list (either filtered or all)
    let vehicleCodes: number[] = targetVehicleCodes;
    if (vehicleCodes.length === 0) {
      const vehiclesData = await autotracFetch(
        `/v1/accounts/${accountCode}/vehicles?_limit=500`,
        AUTOTRAC_API_KEY,
        authHeader
      );
      const vehicles = vehiclesData?.Data || vehiclesData || [];
      vehicleCodes = vehicles.map((v: any) => v.Code);
    }

    console.log(`Syncing telemetry for ${vehicleCodes.length} vehicles on ${dateStr}`);

    // Get cadastros mapping for veiculo_id
    const { data: cadastros } = await supabase.from("cadastros").select("veiculo_id, numero_frota");
    const cadastroMap = new Map<string, string>();
    if (cadastros) {
      for (const c of cadastros) {
        cadastroMap.set(c.numero_frota, c.veiculo_id);
      }
    }

    // Get autotrac_vehicles for name→frota mapping
    const { data: autotracVehicles } = await supabase
      .from("autotrac_vehicles")
      .select("vehicle_code, name")
      .in("vehicle_code", vehicleCodes);

    const vehicleNameMap = new Map<number, string>();
    if (autotracVehicles) {
      for (const v of autotracVehicles) {
        vehicleNameMap.set(v.vehicle_code, v.name);
      }
    }

    let synced = 0;
    let errors = 0;
    const BATCH_SIZE = 10;
    for (let i = 0; i < vehicleCodes.length; i += BATCH_SIZE) {
      const batch = vehicleCodes.slice(i, i + BATCH_SIZE);
      const rowsInBatch: any[] = [];

      await Promise.all(
        batch.map(async (vCode) => {
          try {
            const positions = await fetchAllPositions(
              accountCode,
              vCode,
              startDate,
              endDate,
              AUTOTRAC_API_KEY,
              authHeader
            );

            if (positions.length === 0) return;

            const pontos = positions
              .map((p) => {
                let speed = p.Speed ?? 0;
                if (speed === 0 && p.Landmark) {
                  const match = p.Landmark.match(/([\d.]+)\s*Km\/h/i);
                  if (match) speed = parseFloat(match[1]) || 0;
                }
                const ignition = speed > 0 ? 1 : (p.Ignition ?? 0);
                return {
                  time: p.PositionTime,
                  lat: p.Latitude,
                  lng: p.Longitude,
                  speed,
                  ignition,
                  landmark: p.Landmark ?? null,
                };
              })
              .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

            let distancia = 0;
            for (let j = 1; j < pontos.length; j++) {
              const prev = pontos[j - 1];
              const curr = pontos[j];
              if (prev.lat && prev.lng && curr.lat && curr.lng) {
                distancia += haversineKm(prev.lat, prev.lng, curr.lat, curr.lng);
              }
            }

            const vehicleName = vehicleNameMap.get(vCode) || "";
            const veiculoId = cadastroMap.get(vehicleName) || null;

            rowsInBatch.push({
              vehicle_code: vCode,
              veiculo_id: veiculoId,
              data_jornada: dateStr,
              pontos: pontos as unknown as Record<string, unknown>,
              distancia_km: Math.round(distancia * 10) / 10,
              total_raw: pontos.length,
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          } catch (err) {
            console.error(`Error processing vehicle ${vCode}:`, err);
            errors++;
          }
        })
      );

      if (rowsInBatch.length > 0) {
        const { error: upsertErr } = await supabase
          .from("telemetria_sync")
          .upsert(rowsInBatch, { onConflict: "vehicle_code,data_jornada" });

        if (upsertErr) {
          console.error("Error batch upserting telemetry:", upsertErr.message);
          errors += rowsInBatch.length;
        } else {
          synced += rowsInBatch.length;
        }
      }
    }

    const result = {
      success: true,
      date: dateStr,
      vehiclesProcessed: vehicleCodes.length,
      synced,
      errors,
      syncedAt: new Date().toISOString(),
    };

    console.log("Telemetry sync completed:", result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Telemetry sync error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
