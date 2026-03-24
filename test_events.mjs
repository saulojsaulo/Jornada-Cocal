import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://uewhtmagmftsyzzbeuux.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_f7DstU4sV3PlOnjsueR94g_tiplNJGh";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function check() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("autotrac_eventos")
    .select("id, vehicle_code, macro_number, message_time, driver_password, raw_data")
    .gte("message_time", start.toISOString())
    .order("message_time", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Error:", error);
    return;
  }

  console.log("Events today count:", data.length);
  console.log("Latest events:", data);
}

check();
