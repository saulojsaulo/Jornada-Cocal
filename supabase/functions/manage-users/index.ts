import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify the caller is authenticated
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Nenhum cabeçalho de autorização encontrado' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify caller is authenticated
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user: caller }, error: userError } = await supabaseUser.auth.getUser(token);
    
    if (userError || !caller) {
      return new Response(JSON.stringify({ error: 'Erro de Autenticação/Token Inválido', details: userError }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Only admin can manage users
    if (caller.email !== "saulosantosj@gmail.com") {
      return new Response(JSON.stringify({ error: `Acesso restrito. Seu email: ${caller.email}` }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    if (req.method === 'GET' && action === 'list') {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers();
      if (error) throw error;
      const users = data.users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.user_metadata?.name || '',
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
      }));
      return new Response(JSON.stringify(users), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST' && action === 'create') {
      const { email, password, name } = await req.json();
      if (!email || !password || !name) {
        return new Response(JSON.stringify({ error: 'E-mail, senha e nome são obrigatórios' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, user_id: data.user.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST' && action === 'delete') {
      const { user_id } = await req.json();
      if (!user_id) {
        return new Response(JSON.stringify({ error: 'user_id é obrigatório' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Prevent self-deletion
      if (user_id === caller.id) {
        return new Response(JSON.stringify({ error: 'Você não pode excluir a si mesmo' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { error } = await supabaseAdmin.auth.admin.deleteUser(user_id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Ação inválida' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: typeof err === "string" ? err : err.message || "Erro desconhecido", stack: err?.stack }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
