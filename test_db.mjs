import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env', 'utf-8');
const url = env.match(/VITE_SUPABASE_URL=["']?(.*?)["']?$/m)?.[1]?.trim();
const key = env.match(/VITE_SUPABASE_ANON_KEY=["']?(.*?)["']?$/m)?.[1]?.trim();

const supabase = createClient(url, key);

(async () => {
  const { data: cads } = await supabase.from('cadastros').select('*').limit(3);
  console.log('Cads:', cads);
  
  const { data: vehs } = await supabase.from('autotrac_vehicles').select('*').limit(3);
  console.log('Vehs:', vehs);
})();
