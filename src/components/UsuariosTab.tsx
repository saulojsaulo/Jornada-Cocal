import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { UserPlus, Trash2, Users } from "lucide-react";

interface AppUser {
  id: string;
  email: string;
  name: string;
  created_at: string;
  last_sign_in_at: string | null;
}

export default function UsuariosTab() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("manage-users?action=list", {
      method: "GET",
    });
    if (error) {
      toast.error("Erro ao carregar usuários");
    } else {
      setUsers(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim()) {
      toast.error("Preencha todos os campos");
      return;
    }
    if (password.length < 6) {
      toast.error("A senha deve ter pelo menos 6 caracteres");
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("manage-users?action=create", {
      body: { name, email, password },
    });
    setCreating(false);
    if (error || data?.error) {
      toast.error(data?.error || "Erro ao criar usuário");
    } else {
      toast.success("Usuário criado com sucesso!");
      setName("");
      setEmail("");
      setPassword("");
      fetchUsers();
    }
  };

  const handleDelete = async (userId: string, userEmail: string) => {
    if (!confirm(`Tem certeza que deseja excluir o usuário ${userEmail}?`)) return;
    const { data, error } = await supabase.functions.invoke("manage-users?action=delete", {
      body: { user_id: userId },
    });
    if (error || data?.error) {
      toast.error(data?.error || "Erro ao excluir usuário");
    } else {
      toast.success("Usuário excluído");
      fetchUsers();
    }
  };

  return (
    <div className="space-y-6">
      {/* Create user form */}
      <div className="bg-card border rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-primary" />
          Criar Novo Usuário
        </h2>
        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
          <div className="space-y-1">
            <Label htmlFor="user-name">Nome</Label>
            <Input id="user-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="user-email">E-mail</Label>
            <Input id="user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemplo.com" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="user-password">Senha</Label>
            <Input id="user-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" required />
          </div>
          <Button type="submit" disabled={creating}>
            <UserPlus className="h-4 w-4 mr-2" />
            {creating ? "Criando..." : "Criar"}
          </Button>
        </form>
      </div>

      {/* User list */}
      <div className="bg-card border rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          Usuários Cadastrados
        </h2>
        {loading ? (
          <p className="text-muted-foreground text-sm">Carregando...</p>
        ) : users.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhum usuário encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4 font-medium text-muted-foreground">Nome</th>
                  <th className="py-2 pr-4 font-medium text-muted-foreground">E-mail</th>
                  <th className="py-2 pr-4 font-medium text-muted-foreground">Criado em</th>
                  <th className="py-2 pr-4 font-medium text-muted-foreground">Último login</th>
                  <th className="py-2 font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{user.name || "—"}</td>
                    <td className="py-2 pr-4">{user.email}</td>
                    <td className="py-2 pr-4">{new Date(user.created_at).toLocaleDateString("pt-BR")}</td>
                    <td className="py-2 pr-4">
                      {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("pt-BR") : "Nunca"}
                    </td>
                    <td className="py-2">
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(user.id, user.email || "")}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
