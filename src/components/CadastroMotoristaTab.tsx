import { useState, useEffect, useMemo, useRef } from "react";
import { Search, Plus, Trash2, Save, X, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface Motorista {
  id: string;
  external_id: string | null;
  nome: string;
  cpf: string | null;
  telefone: string | null;
  senha: string | null;
  ativo: boolean;
}

interface MotoristaForm {
  nome: string;
  cpf: string;
  telefone: string;
  senha: string;
}

const emptyForm: MotoristaForm = { nome: "", cpf: "", telefone: "", senha: "" };

export default function CadastroMotoristaTab() {
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState<MotoristaForm>(emptyForm);
  const [isAdding, setIsAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchMotoristas = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("motoristas")
      .select("*")
      .eq("ativo", true)
      .order("nome");
    if (error) toast.error("Erro ao carregar motoristas");
    else setMotoristas((data as unknown as Motorista[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchMotoristas(); }, []);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return motoristas;
    const q = searchQuery.toLowerCase();
    return motoristas.filter((m) => m.nome.toLowerCase().includes(q) || m.cpf?.includes(q));
  }, [motoristas, searchQuery]);

  const handleAdd = async () => {
    if (!form.nome.trim()) { toast.error("Nome é obrigatório"); return; }
    setSaving(true);
    const { error } = await supabase.from("motoristas").insert({
      nome: form.nome.trim(),
      cpf: form.cpf.trim() || null,
      telefone: form.telefone.trim() || null,
      senha: form.senha.trim() || null,
      ativo: true,
    } as any);
    setSaving(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Motorista cadastrado");
    setForm(emptyForm);
    setIsAdding(false);
    fetchMotoristas();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Deseja desativar este motorista?")) return;
    const { error } = await supabase.from("motoristas").update({ ativo: false } as any).eq("id", id);
    if (error) toast.error("Erro: " + error.message);
    else { toast.success("Motorista desativado"); fetchMotoristas(); }
  };

  const handleImportXlsx = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
      if (rows.length === 0) { toast.error("Planilha vazia"); setImporting(false); return; }
      const normalize = (obj: Record<string, unknown>) => {
        const keys = Object.keys(obj);
        const find = (candidates: string[]) => {
          const key = keys.find((k) => candidates.includes(k.toLowerCase().trim()));
          return key ? String(obj[key]).trim() : "";
        };
        return { nome: find(["nome", "motorista", "name", "nome completo", "nome_motorista"]), cpf: find(["cpf", "documento", "doc"]), telefone: find(["telefone", "tel", "celular", "phone", "fone"]) };
      };
      const existingNames = new Set(motoristas.map((m) => m.nome.toLowerCase()));
      const parsed = rows.map(normalize).filter((r) => r.nome && !existingNames.has(r.nome.toLowerCase()));
      if (parsed.length === 0) { toast.info("Nenhum motorista novo encontrado"); setImporting(false); return; }
      const toInsert = parsed.map((r) => ({ nome: r.nome, cpf: r.cpf || null, telefone: r.telefone || null, ativo: true }));
      let inserted = 0;
      for (let i = 0; i < toInsert.length; i += 50) {
        const batch = toInsert.slice(i, i + 50);
        const { error } = await supabase.from("motoristas").insert(batch as any);
        if (error) { toast.error("Erro na importação: " + error.message); break; }
        inserted += batch.length;
      }
      toast.success(`${inserted} motorista(s) importado(s)`);
      fetchMotoristas();
    } catch { toast.error("Erro ao ler arquivo XLSX"); } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (loading) return <p className="text-center py-12 text-muted-foreground">Carregando motoristas...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Cadastro de Motoristas</h2>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleImportXlsx} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} disabled={importing} className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted disabled:opacity-50">
            <Upload className="h-4 w-4" /> {importing ? "Importando..." : "Importar XLSX"}
          </button>
          <button onClick={() => { setIsAdding(true); setForm(emptyForm); }} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Novo Motorista
          </button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input type="text" placeholder="Buscar motorista..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
      </div>

      {isAdding && (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold">Novo Motorista</h3>
          <div className="grid grid-cols-4 gap-3">
            <input placeholder="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="border rounded-lg px-3 py-2 text-sm bg-background" />
            <input placeholder="CPF" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} className="border rounded-lg px-3 py-2 text-sm bg-background" />
            <input placeholder="Telefone" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} className="border rounded-lg px-3 py-2 text-sm bg-background" />
            <input placeholder="Senha (Autotrac)" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} className="border rounded-lg px-3 py-2 text-sm bg-background font-mono" />
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
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">CPF</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Telefone</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Senha</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground w-24">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.id} className="border-b hover:bg-muted/20">
                <td className="px-3 py-1.5 font-medium">{m.nome}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{m.cpf || "—"}</td>
                <td className="px-3 py-1.5 text-xs">{m.telefone || "—"}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{m.senha ? "••••••" : "—"}</td>
                <td className="px-3 py-1.5 text-center">
                  <button onClick={() => handleDelete(m.id)} className="text-destructive hover:text-destructive/80 p-1" title="Desativar">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">Nenhum motorista encontrado</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{filtered.length} motorista(s)</p>
    </div>
  );
}
