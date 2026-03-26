import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://uewhtmagmftsyzzbeuux.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_f7DstU4sV3PlOnjsueR94g_tiplNJGh";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  const start = new Date();
  start.setDate(start.getDate() - 7);
  console.log(`Checking volume since ${start.toISOString()}...`);

  const startTime = Date.now();
  const { count, error } = await supabase
    .from('autotrac_eventos')
    .select('*', { count: 'exact', head: true })
    .gte('message_time', start.toISOString());
  const duration = Date.now() - startTime;

  if (error) {
    console.error("Error fetching count:", error.message);
  } else {
    console.log(`Total events in last 7 days: ${count}`);
    console.log(`Query duration: ${duration}ms`);
  }

  const start2d = new Date();
  start2d.setDate(start2d.getDate() - 2);
  const startTime2d = Date.now();
  const { count: count2d } = await supabase
    .from('autotrac_eventos')
    .select('*', { count: 'exact', head: true })
    .gte('message_time', start2d.toISOString());
  console.log(`Total events in last 2 days: ${count2d} (Query duration: ${Date.now() - startTime2d}ms)`);
}

main().catch(console.error);
