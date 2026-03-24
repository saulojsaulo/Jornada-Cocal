import fs from 'fs';

const env = fs.readFileSync('.env', 'utf-8');
const url = env.match(/VITE_SUPABASE_URL=["']?(.*?)["']?$/m)?.[1]?.trim();
const key = env.match(/VITE_SUPABASE_ANON_KEY=["']?(.*?)["']?$/m)?.[1]?.trim();

(async () => {
  console.log("Calling " + url + "/functions/v1/manage-users?action=list");
  const res = await fetch(`${url}/functions/v1/manage-users?action=list`, {
    method: 'GET',
    headers: { 
      'Authorization': `Bearer ${key}`
    }
  });
  
  console.log('Status:', res.status, res.statusText);
  try {
    const text = await res.text();
    console.log('Body:', text);
  } catch (e) {
    console.log('Could not read body:', e);
  }
})();
