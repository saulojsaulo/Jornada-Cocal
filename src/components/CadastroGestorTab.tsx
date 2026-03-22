import { useState, useEffect, useMemo } from "react";
import { Search, Plus, Trash2, Save, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Gestor {
  id: string;
  external_id: string | null;
  nome: string;
  email: string | null;
  telefone: string | null;
  ativo: boolean;
}

interface GestorForm {
  nome: string;
  email: string;
  telefone: string;
}

const emptyForm: GestorForm = { nome: "", email: "", telefone: "" };

export default function CadastroGestorTab() {
  const [gestores, setGestores] = useState<Gestor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState<GestorForm>(emptyForm);
  const [isAdding, setIsAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchGestores = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("gestores")
      .select("*")
      .eq("ativo", true)
      .order("nome");
    if (error) {
      toast.error("Erro ao carregar gestores: " + error.message);
      setGestores([]);
    } else {
      setGestores((data as unknown as Gestor[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchGestores(); }, []);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return gestores;
    const q = searchQuery.toLowerCase();
    return gestores.filter((g) => g.nome.toLowerCase().includes(q) || g.email?.toLowerCase().includes(q));
  }, [gestores, searchQuery]);

  const handleAdd = async () => {
    if (!form.nome.trim()) { toast.error("Nome é obrigatório"); return; }
    setSaving(true);
    const { error } = await supabase.from("gestores").insert({
      nome: form.nome.trim(),
      email: form.email.trim() || null,
      telefone: form.telefone.trim() || null,
      ativo: true,
    } as any);
    setSaving(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Gestor cadastrado");
    setForm(emptyForm);
    setIsAdding(false);
    fetchGestores();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Deseja desativar este gestor?")) return;
    const { error } = await supabase.from("gestores").update({ ativo: false } as any).eq("id", id);
    if (error) toast.error("Erro: " + error.message);
    else { toast.success("Gestor desativado"); fetchGestores(); }
  };

  if (loading) return <p className="text-center py-12 text-muted-foreground">Carregando gestores...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Cadastro de Gestores</h2>
        <button onClick={() => { setIsAdding(true); setForm(emptyForm); }} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Novo Gestor
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input type="text" placeholder="Buscar gestor..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
      </div>

      {isAdding && (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold">Novo Gestor</h3>
          <div className="grid grid-cols-3 gap-3">
            <input placeholder="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="border rounded-lg px-3 py-2 text-sm bg-background" />
            <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="border rounded-lg px-3 py-2 text-sm bg-background" />
            <input placeholder="Telefone" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} className="border rounded-lg px-3 py-2 text-sm bg-background" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> {saving ? "Salvando..." : "Salvar"}
            </button>
            <button onClick={() => setIsAdding(false)} className="flex items-center gap-1 px-3 py-1.5 border rounded-lg text-sm hover:bg-muted">
              <X className="h-3.5 w-3.5" /> Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Nome</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Email</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Telefone</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground w-24">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => (
              <tr key={g.id} className="border-b hover:bg-muted/20">
                <td className="px-3 py-1.5 font-medium">{g.nome}</td>
                <td className="px-3 py-1.5 text-xs">{g.email || "—"}</td>
                <td className="px-3 py-1.5 text-xs">{g.telefone || "—"}</td>
                <td className="px-3 py-1.5 text-center">
                  <button onClick={() => handleDelete(g.id)} className="text-destructive hover:text-destructive/80 p-1" title="Desativar">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">Nenhum gestor encontrado</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{filtered.length} gestor(es)</p>
    </div>
  );
}
