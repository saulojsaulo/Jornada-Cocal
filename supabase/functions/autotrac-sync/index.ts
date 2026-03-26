import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUTOTRAC_BASE_URL = "https://aapi3.autotrac-online.com.br/aticapi";
const VALID_MACROS = new Set([1, 2, 3, 4, 5, 6, 9, 10]);

interface AutotracVehicle {
  Code: number;
  Name: string;
  Number: number;
  Plate?: string;
  AccountNumber?: number;
  FamilyDescription?: string;
}

interface AutotracReturnMessage {
  ID: number;
  AccountNumber: number;
  VehicleAddress: number;
  MacroNumber: number;
  MacroVersion: number;
  MessageTime: string;
  Latitude: number;
  Longitude: number;
  PositionTime: string;
  Landmark: string;
  Ignition: number;
  Priority: number;
  Grmn: number;
  BinaryDataType: number;
  MsgSubType: number;
  MessageText: string;
  TransmissionChannel: number;
}

interface AutotracPosition {
  VehicleCode: number;
  Latitude: number;
  Longitude: number;
  PositionTime: string;
  Landmark: string;
  Speed: number;
  Ignition: number;
}

async function autotracFetch(path: string, apiKey: string, authHeader: string): Promise<any> {
  const url = `${AUTOTRAC_BASE_URL}${path}`;
  console.log(`Fetching: ${url}`);
  console.log(`Auth header: ${authHeader.substring(0, 20)}...`);

  const resp = await fetch(url, {
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`API error response: ${text}`);
    throw new Error(`Autotrac API error [${resp.status}] for ${path}: ${text}`);
  }

  return resp.json();
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

    const credentials = `${AUTOTRAC_USERNAME}:${AUTOTRAC_PASSWORD}`;
    const authHeader = `Basic ${btoa(credentials)}`;
    console.log(`Auth configured for: ${AUTOTRAC_USERNAME}`);
    // 1. Get accounts to find the account code
    const accountsData = await autotracFetch("/v1/accounts", AUTOTRAC_API_KEY, authHeader);
    const accounts = accountsData?.Data || accountsData || [];
    console.log(`Found ${Array.isArray(accounts) ? accounts.length : 0} accounts`);

    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw new Error("No accounts found in Autotrac API");
    }

    // Use the account matching the configured number, or the first one
    let accountCode: number;
    if (AUTOTRAC_ACCOUNT_NUMBER) {
      const matchingAccount = accounts.find(
        (a: any) => String(a.Number) === AUTOTRAC_ACCOUNT_NUMBER || String(a.Code) === AUTOTRAC_ACCOUNT_NUMBER
      );
      accountCode = matchingAccount?.Code || accounts[0].Code;
    } else {
      accountCode = accounts[0].Code;
    }
    console.log(`Using account code: ${accountCode}`);

    // 2. Fetch vehicles
    const vehiclesData = await autotracFetch(
      `/v1/accounts/${accountCode}/vehicles?_limit=500`,
      AUTOTRAC_API_KEY,
      authHeader
    );
    const vehicles: AutotracVehicle[] = vehiclesData?.Data || vehiclesData || [];
    console.log(`Found ${vehicles.length} vehicles`);

    // Upsert vehicles
    if (vehicles.length > 0) {
      const vehicleRows = vehicles.map((v) => ({
        vehicle_code: v.Code,
        account_code: accountCode,
        name: v.Name,
        vehicle_address: v.Number,
        plate: v.Plate || null,
        account_number: String(v.AccountNumber || ""),
        family_description: v.FamilyDescription || null,
        updated_at: new Date().toISOString(),
      }));

      const { error: vErr } = await supabase
        .from("autotrac_vehicles")
        .upsert(vehicleRows, { onConflict: "vehicle_code" });

      if (vErr) console.error("Error upserting vehicles:", vErr);
      else console.log(`Upserted ${vehicleRows.length} vehicles`);
    }

    // 3. Fetch return messages (macro events) for each vehicle
    let totalEvents = 0;
    let totalPositions = 0;

    // Process vehicles in batches to avoid timeout
    const BATCH_SIZE = 10;
    for (let i = 0; i < vehicles.length; i += BATCH_SIZE) {
      const batch = vehicles.slice(i, i + BATCH_SIZE);
      const allEventsInBatch: any[] = [];
      const allPositionsInBatch: any[] = [];

      await Promise.all(batch.map(async (vehicle) => {
        try {
          // Fetch return messages
          const messagesData = await autotracFetch(
            `/v1/accounts/${accountCode}/vehicles/${vehicle.Code}/returnmessages?_limit=500`,
            AUTOTRAC_API_KEY,
            authHeader
          );
          const messages: AutotracReturnMessage[] = messagesData?.Data || messagesData || [];
          const macroEvents = messages.filter((m) => VALID_MACROS.has(m.MacroNumber));

          if (macroEvents.length > 0) {
            macroEvents.forEach((m) => {
              const passwordMatch = (m.MessageText || "").match(/^_(\w+)/);
              allEventsInBatch.push({
                autotrac_id: m.ID,
                vehicle_code: vehicle.Code,
                account_number: m.AccountNumber,
                macro_number: m.MacroNumber,
                macro_version: m.MacroVersion,
                message_time: m.MessageTime,
                latitude: m.Latitude,
                longitude: m.Longitude,
                landmark: m.Landmark || null,
                ignition: m.Ignition,
                position_time: m.PositionTime || null,
                vehicle_address: m.VehicleAddress,
                driver_password: passwordMatch ? passwordMatch[1] : null,
                raw_data: m as unknown as Record<string, unknown>,
              });
            });
          }

          // Fetch positions
          try {
            const posData = await autotracFetch(
              `/v1/accounts/${accountCode}/vehicles/${vehicle.Code}/positions?_limit=1`,
              AUTOTRAC_API_KEY,
              authHeader
            );
            const positions = posData?.Data || posData || [];
            if (Array.isArray(positions) && positions.length > 0) {
              const pos = positions[0];
              allPositionsInBatch.push({
                vehicle_code: vehicle.Code,
                latitude: pos.Latitude,
                longitude: pos.Longitude,
                landmark: pos.Landmark || null,
                speed: pos.Speed || 0,
                ignition: pos.Ignition || 0,
                position_time: pos.PositionTime || null,
                updated_at: new Date().toISOString(),
              });
            }
          } catch (posErr) {
            console.error(`Error fetching positions for vehicle ${vehicle.Code}:`, posErr);
          }
        } catch (err) {
          console.error(`Error processing vehicle ${vehicle.Code}:`, err);
        }
      }));

      // Execute bulk upserts for the entire batch
      if (allEventsInBatch.length > 0) {
        const { error: eErr } = await supabase
          .from("autotrac_eventos")
          .upsert(allEventsInBatch, { onConflict: "vehicle_code,macro_number,message_time", ignoreDuplicates: true });
        if (eErr) console.error("Error batch upserting events:", eErr);
        else totalEvents += allEventsInBatch.length;
      }

      if (allPositionsInBatch.length > 0) {
        const { error: pErr } = await supabase
          .from("autotrac_positions")
          .upsert(allPositionsInBatch, { onConflict: "vehicle_code" });
        if (pErr) console.error("Error batch upserting positions:", pErr);
        else totalPositions += allPositionsInBatch.length;
      }
    }

    const result = {
      success: true,
      accounts: accounts.length,
      accountCode,
      vehicles: vehicles.length,
      events: totalEvents,
      positions: totalPositions,
      syncedAt: new Date().toISOString(),
    };

    console.log("Sync completed:", result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Sync error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
