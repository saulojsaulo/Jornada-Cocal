import { useState, useEffect } from "react";
import { FileText, Search, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import RankingTab from "@/components/RankingTab";
import { toast } from "sonner";

interface Motorista {
  id: string;
  nome: string;
  cpf: string | null;
}

interface Cadastro {
  veiculo_id: string;
  nome_veiculo: string;
  numero_frota: string;
  motorista_nome: string | null;
  motorista_id: string | null;
}

type PeriodoType = "mes_atual" | "mes_anterior" | "personalizado";
type ReportType = "ficha_ponto" | "ranking";

export default function RelatoriosTab() {
  const [selectedReport, setSelectedReport] = useState<ReportType>("ficha_ponto");
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [cadastros, setCadastros] = useState<Cadastro[]>([]);
  const [autotracVehicles, setAutotracVehicles] = useState<any[]>([]);
  const [selectedMotorista, setSelectedMotorista] = useState<string>("");
  const [selectedFrota, setSelectedFrota] = useState<string>("all");
  const [periodo, setPeriodo] = useState<PeriodoType>("mes_atual");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [{ data: mData }, { data: cData }, { data: avData }] = await Promise.all([
      supabase.from("motoristas").select("id, nome, cpf").eq("ativo", true).order("nome"),
      supabase.from("cadastros").select("veiculo_id, nome_veiculo, numero_frota, motorista_nome, motorista_id").eq("ativo", true),
      (supabase as any).from("autotrac_vehicles").select("vehicle_code, name"),
    ]);
    if (mData) setMotoristas(mData);
    if (cData) setCadastros(cData);
    if (avData) setAutotracVehicles(avData);
  };

  const getDateRange = (): { start: string; end: string } => {
    const now = new Date();
    if (periodo === "mes_atual") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start: fmt(start), end: fmt(end) };
    }
    if (periodo === "mes_anterior") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: fmt(start), end: fmt(end) };
    }
    return { start: dataInicio, end: dataFim };
  };

  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const handleGenerate = () => {
    if (!selectedMotorista) {
      toast.error("Selecione um motorista");
      return;
    }
    const { start, end } = getDateRange();
    if (!start || !end) {
      toast.error("Selecione o período");
      return;
    }

    const motorista = motoristas.find((m) => m.id === selectedMotorista);
    const driverCadastros = cadastros.filter(c => c.motorista_id === selectedMotorista || c.motorista_nome === motorista?.nome);

    const resolveVehicleCode = (cadastro: Cadastro): string | null => {
      const frotaNum = cadastro.numero_frota;
      const av = autotracVehicles.find((v: any) => {
        const vName = v.name?.trim() || "";
        const numMatch = vName.match(/^(\d+)/);
        const vFrota = numMatch ? numMatch[1] : "";
        return vFrota.padStart(3, "0") === frotaNum.padStart(3, "0");
      });
      return av ? String(av.vehicle_code) : null;
    };

    let vehicleCodes: string[];
    if (selectedFrota !== "all") {
      const cad = driverCadastros.find(c => c.veiculo_id === selectedFrota);
      if (cad) {
        const vc = resolveVehicleCode(cad);
        vehicleCodes = vc ? [vc] : [];
      } else {
        vehicleCodes = [];
      }
    } else {
      vehicleCodes = driverCadastros.map(c => resolveVehicleCode(c)).filter(Boolean) as string[];
    }

    if (vehicleCodes.length === 0) {
      toast.error("Nenhum veículo encontrado para este motorista");
      return;
    }

    const params = new URLSearchParams({
      motorista_id: selectedMotorista,
      motorista_nome: motorista?.nome || "",
      motorista_cpf: motorista?.cpf || "",
      start,
      end,
      vehicle_codes: vehicleCodes.join(","),
      frota: selectedFrota !== "all" ? (driverCadastros.find(c => c.veiculo_id === selectedFrota)?.numero_frota || "") : "",
    });

    window.open(`/relatorio/ficha-ponto?${params.toString()}`, "_blank");
  };

  const motoristaObj = motoristas.find(m => m.id === selectedMotorista);
  const frotasDoMotorista = cadastros.filter(c => c.motorista_id === selectedMotorista || c.motorista_nome === motoristaObj?.nome);

  const reports: { id: ReportType; label: string; icon: typeof FileText }[] = [
    { id: "ficha_ponto", label: "Ficha de Ponto", icon: FileText },
    { id: "ranking", label: "Ranking de Horas Extras", icon: BarChart3 },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <FileText className="h-5 w-5" />
        Relatórios
      </h2>

      {/* Report selector */}
      <div className="flex gap-2 border-b pb-0">
        {reports.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelectedReport(r.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              selectedReport === r.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            <r.icon className="h-4 w-4" />
            {r.label}
          </button>
        ))}
      </div>

      {selectedReport === "ranking" && <RankingTab />}

      {selectedReport === "ficha_ponto" && (
        <div className="border rounded-lg p-6 bg-card space-y-6 max-w-2xl">
          <h3 className="font-medium text-sm flex items-center gap-2">
            📋 Ficha de Ponto do Motorista
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Motorista *</Label>
              <Select value={selectedMotorista} onValueChange={setSelectedMotorista}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Selecione o motorista" />
                </SelectTrigger>
                <SelectContent>
                  {motoristas.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Frota</Label>
              <Select value={selectedFrota} onValueChange={setSelectedFrota}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">Todas</SelectItem>
                  {frotasDoMotorista.map((c) => (
                    <SelectItem key={c.veiculo_id} value={c.veiculo_id} className="text-xs">
                      {c.numero_frota} - {c.nome_veiculo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Período</Label>
              <Select value={periodo} onValueChange={(v) => setPeriodo(v as PeriodoType)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mes_atual" className="text-xs">Mês Atual</SelectItem>
                  <SelectItem value="mes_anterior" className="text-xs">Mês Anterior</SelectItem>
                  <SelectItem value="personalizado" className="text-xs">Selecionar Período</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {periodo === "personalizado" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Data Início</Label>
                  <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="h-9 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Data Fim</Label>
                  <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="h-9 text-xs" />
                </div>
              </>
            )}
          </div>

          <Button onClick={handleGenerate} className="gap-2" disabled={!selectedMotorista}>
            <Search className="h-4 w-4" />
            Gerar Relatório
          </Button>
        </div>
      )}
    </div>
  );
}
