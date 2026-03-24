import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("Fetching some active drivers...");
  const { data: drivers } = await supabase.from('motoristas').select('id, nome, senha').limit(5);
  console.log("Drivers:", drivers);

  console.log("Checking how many events have a driver_password...");
  const { count: withPwd } = await supabase.from('autotrac_eventos').select('*', { count: 'exact', head: true }).not('driver_password', 'is', null);
  const { count: withoutPwd } = await supabase.from('autotrac_eventos').select('*', { count: 'exact', head: true }).is('driver_password', null);
  
  console.log(`With driver_password: ${withPwd}`);
  console.log(`Without driver_password: ${withoutPwd}`);
}

main().catch(console.error);
