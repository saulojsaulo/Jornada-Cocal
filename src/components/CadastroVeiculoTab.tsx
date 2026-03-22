import { useState, useEffect, useMemo, useCallback } from "react";
import { Search, Plus, Trash2, Save, X, UserPlus, Shield } from "lucide-react";
import { useJourneyStore } from "@/context/JourneyContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Cadastro {
  id: string;
  veiculo_id: string;
  nome_veiculo: string;
  numero_frota: string;
  placa: string;
  motorista_id: string | null;
  motorista_nome: string | null;
  gestor_id: string | null;
  gestor_nome: string | null;
  ativo: boolean;
}

interface LocalMotorista {
  id: string;
  nome: string;
}

interface LocalGestor {
  id: string;
  nome: string;
}

export default function CadastroVeiculoTab() {
  const { vehicles } = useJourneyStore();
  const [cadastros, setCadastros] = useState<Cadastro[]>([]);
  const [motoristas, setMotoristas] = useState<LocalMotorista[]>([]);
  const [gestores, setGestores] = useState<LocalGestor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMotorista, setEditMotorista] = useState<string>("");
  const [editGestor, setEditGestor] = useState<string>("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [cadastrosRes, motoristasRes, gestoresRes] = await Promise.all([
      supabase.from("cadastros").select("*").eq("ativo", true).order("updated_at", { ascending: false }),
      supabase.from("motoristas").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("gestores").select("id, nome").eq("ativo", true).order("nome"),
    ]);

    if (cadastrosRes.data) {
      // Deduplicate by numero_frota, keeping records with motorista/gestor data first, then most recent
      const seen = new Map<string, any>();
      const duplicateIds: string[] = [];
      for (const row of cadastrosRes.data) {
        const r = row as unknown as Cadastro;
        const key = r.numero_frota;
        const existing = seen.get(key);
        if (existing) {
          // Keep the one with more data (motorista/gestor assigned)
          const existingScore = (existing.motorista_id ? 1 : 0) + (existing.gestor_id ? 1 : 0);
          const newScore = (r.motorista_id ? 1 : 0) + (r.gestor_id ? 1 : 0);
          if (newScore > existingScore) {
            duplicateIds.push(existing.id);
            seen.set(key, r);
          } else {
            duplicateIds.push(r.id);
          }
        } else {
          seen.set(key, r);
        }
      }
      // Deactivate duplicates in background
      if (duplicateIds.length > 0) {
        supabase.from("cadastros").update({ ativo: false } as any).in("id", duplicateIds).then(({ error }) => {
          if (error) console.error("Dedup error:", error.message);
          else console.log(`Deactivated ${duplicateIds.length} duplicate(s)`);
        });
      }
      const unique = Array.from(seen.values()).sort((a: Cadastro, b: Cadastro) =>
        a.numero_frota.localeCompare(b.numero_frota, undefined, { numeric: true })
      );
      setCadastros(unique);
    }
    if (motoristasRes.data) setMotoristas(motoristasRes.data as unknown as LocalMotorista[]);
    if (gestoresRes.data) setGestores(gestoresRes.data as unknown as LocalGestor[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const syncVehicles = async () => {
    const existingIds = new Set(cadastros.map((c) => c.veiculo_id));
    const toSync = vehicles.filter((v) => !existingIds.has(v.id));
    if (toSync.length === 0) { toast.info("Todos os veículos já estão cadastrados"); return; }
    const rows = toSync.map((v) => ({
      veiculo_id: v.id,
      nome_veiculo: v.name,
      numero_frota: v.name.replace(/\D/g, ""),
      placa: "",
      motorista_id: null,
      motorista_nome: null,
      gestor_id: null,
      gestor_nome: null,
      ativo: true,
    }));
    const { error } = await supabase.from("cadastros").upsert(rows as any, { onConflict: "veiculo_id" });
    if (error) { toast.error("Erro ao sincronizar: " + error.message); return; }
    toast.success(`${toSync.length} veículo(s) sincronizado(s)`);
    fetchAll();
  };

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return cadastros;
    const q = searchQuery.toLowerCase();
    return cadastros.filter(
      (c) => c.numero_frota.includes(q) || c.nome_veiculo.toLowerCase().includes(q) || c.motorista_nome?.toLowerCase().includes(q) || c.gestor_nome?.toLowerCase().includes(q)
    );
  }, [cadastros, searchQuery]);

  const handleEdit = (c: Cadastro) => { setEditingId(c.id); setEditMotorista(c.motorista_id || ""); setEditGestor(c.gestor_id || ""); };

  const handleSave = async (c: Cadastro) => {
    const selectedMotorista = motoristas.find((m) => m.id === editMotorista);
    const selectedGestor = gestores.find((g) => g.id === editGestor);
    const { error } = await supabase.from("cadastros").update({
      motorista_id: editMotorista || null,
      motorista_nome: selectedMotorista?.nome || null,
      gestor_id: editGestor || null,
      gestor_nome: selectedGestor?.nome || null,
      updated_at: new Date().toISOString(),
    } as any).eq("id", c.id);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Veículo atualizado");
    setEditingId(null);
    fetchAll();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Deseja desativar este veículo do cadastro?")) return;
    const { error } = await supabase.from("cadastros").update({ ativo: false } as any).eq("id", id);
    if (error) toast.error("Erro: " + error.message);
    else { toast.success("Veículo desativado"); fetchAll(); }
  };

  const assignedMotoristaIds = useMemo(
    () => new Set(cadastros.filter((c) => c.motorista_id && c.id !== editingId).map((c) => c.motorista_id!)),
    [cadastros, editingId]
  );

  if (loading) return <p className="text-center py-12 text-muted-foreground">Carregando cadastros...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Cadastro de Veículos (Frota)</h2>
        <button onClick={syncVehicles} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Sincronizar Veículos
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input type="text" placeholder="Buscar por frota, nome ou motorista..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Frota</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Nome Veículo</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Motorista</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Gestor</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground w-28">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const isEditing = editingId === c.id;
              return (
                <tr key={c.id} className="border-b hover:bg-muted/20">
                  <td className="px-3 py-1.5 font-bold font-mono">{c.numero_frota || "—"}</td>
                  <td className="px-3 py-1.5 text-xs">{c.nome_veiculo}</td>
                  <td className="px-3 py-1.5">
                    {isEditing ? (
                      <select value={editMotorista} onChange={(e) => setEditMotorista(e.target.value)} className="border rounded px-2 py-1 text-xs bg-background w-full max-w-[200px]">
                        <option value="">— Nenhum —</option>
                        {motoristas.map((m) => (
                          <option key={m.id} value={m.id} disabled={assignedMotoristaIds.has(m.id)}>
                            {m.nome} {assignedMotoristaIds.has(m.id) ? "(vinculado)" : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs flex items-center gap-1"><UserPlus className="h-3 w-3 text-muted-foreground" />{c.motorista_nome || "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {isEditing ? (
                      <select value={editGestor} onChange={(e) => setEditGestor(e.target.value)} className="border rounded px-2 py-1 text-xs bg-background w-full max-w-[200px]">
                        <option value="">— Nenhum —</option>
                        {gestores.map((g) => (<option key={g.id} value={g.id}>{g.nome}</option>))}
                      </select>
                    ) : (
                      <span className="text-xs flex items-center gap-1"><Shield className="h-3 w-3 text-muted-foreground" />{c.gestor_nome || "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {isEditing ? (
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => handleSave(c)} className="text-primary hover:text-primary/80 p-1" title="Salvar"><Save className="h-3.5 w-3.5" /></button>
                        <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground p-1" title="Cancelar"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => handleEdit(c)} className="text-primary hover:text-primary/80 p-1" title="Editar vínculos"><UserPlus className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDelete(c.id)} className="text-destructive hover:text-destructive/80 p-1" title="Desativar"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">Nenhum veículo cadastrado. Clique em "Sincronizar Veículos" para importar.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{filtered.length} veículo(s)</p>
    </div>
  );
}
