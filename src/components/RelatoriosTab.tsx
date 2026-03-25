import { useState, useEffect } from "react";
import { FileText, Search, BarChart3, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import RankingTab from "@/components/RankingTab";
import { toast } from "sonner";
import { useJourneyStore } from "@/context/JourneyContext";

interface Motorista {
  id: string;
  nome: string;
  cpf: string | null;
  senha: string | null;
}

interface Cadastro {
  veiculo_id: string;
  nome_veiculo: string;
  numero_frota: string;
  motorista_nome: string | null;
  motorista_id: string | null;
}

type PeriodoType = "mes_atual" | "mes_anterior" | "personalizado";
type ReportType = "ficha_ponto" | "ranking" | "alteracoes_manuais" | "ausencia_marcacoes";

export default function RelatoriosTab() {
  const { motoristas, cadastros, autotracVehicles } = useJourneyStore();
  const [selectedReport, setSelectedReport] = useState<ReportType>("ficha_ponto");

  const [selectedMotorista, setSelectedMotorista] = useState<string>("");
  const [selectedFrota, setSelectedFrota] = useState<string>("all");
  const [periodo, setPeriodo] = useState<PeriodoType>("mes_atual");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

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


  const handleGenerate = async () => {
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
      const frotaNum = (cadastro.numero_frota || "").trim();
      const av = autotracVehicles.find((v: any) => {
        const vName = (v.name || "").trim();
        const numMatch = vName.match(/^(\d+)/);
        const vFrota = numMatch ? numMatch[1] : "";
        return (
          vFrota === frotaNum ||
          vFrota.replace(/^0+/, "") === frotaNum.replace(/^0+/, "") ||
          vFrota.padStart(4, "0") === frotaNum.padStart(4, "0") ||
          vFrota.padStart(3, "0") === frotaNum.padStart(3, "0") ||
          vName === frotaNum
        );
      });
      return av ? String(av.vehicle_code) : null;
    };

    let vehicleCodes: string[];
    if (selectedFrota !== "all") {
      const cad = driverCadastros.find(c => c.veiculo_id === selectedFrota);
      vehicleCodes = cad ? [resolveVehicleCode(cad)].filter(Boolean) as string[] : [];
    } else {
      vehicleCodes = driverCadastros.map(c => resolveVehicleCode(c)).filter(Boolean) as string[];
    }

    // If no vehicle codes resolved but driver has senha: discover codes from autotrac_eventos
    if (vehicleCodes.length === 0 && motorista?.senha) {
      toast.info("Buscando veículos associados ao motorista...");
      try {
        // Same OR filter logic used in MovimentoCondutorTab
        const orQuery = `raw_data->>MessageText.ilike.%_${motorista.senha}%`;
        const startISO = new Date(start + "T00:00:00").toISOString();
        const endISO = new Date(end + "T23:59:59").toISOString();

        const { data: discoverData, error } = await (supabase as any)
          .from("autotrac_eventos")
          .select("vehicle_code")
          .gte("message_time", startISO)
          .lte("message_time", endISO)
          .or(orQuery);

        if (!error && discoverData?.length) {
          const codeSet = new Set<string>();
          for (const row of discoverData) codeSet.add(String(row.vehicle_code));
          vehicleCodes = Array.from(codeSet);
        }
      } catch (_) { /* ignore, proceed with empty codes */ }
    }

    if (vehicleCodes.length === 0 && !motorista?.senha) {
      toast.error("Motorista não possui senha cadastrada nem vínculo com frota. Verifique em Cadastros.");
      return;
    }

    const params = new URLSearchParams({
      motorista_id: selectedMotorista,
      motorista_nome: motorista?.nome || "",
      motorista_cpf: motorista?.cpf || "",
      senha: motorista?.senha || "",
      start,
      end,
      vehicle_codes: vehicleCodes.join(","),
      frota: selectedFrota !== "all" ? (driverCadastros.find(c => c.veiculo_id === selectedFrota)?.numero_frota || "") : "",
    });

    let route = "/relatorio/ficha-ponto";
    if (selectedReport === "alteracoes_manuais") route = "/relatorio/alteracoes-manuais";
    if (selectedReport === "ausencia_marcacoes") route = "/relatorio/ausencia-marcacoes";

    window.open(`${route}?${params.toString()}`, "_blank");
  };


  const motoristaObj = motoristas.find(m => m.id === selectedMotorista);
  const frotasDoMotorista = cadastros.filter(c => c.motorista_id === selectedMotorista || c.motorista_nome === motoristaObj?.nome);

  const reports: { id: ReportType; label: string; icon: typeof FileText }[] = [
    { id: "ficha_ponto", label: "Ficha de Ponto", icon: FileText },
    { id: "ranking", label: "Ranking de Horas Extras", icon: BarChart3 },
    { id: "alteracoes_manuais", label: "Alterações Manuais", icon: FileText },
    { id: "ausencia_marcacoes", label: "Ausência de Marcações", icon: AlertCircle },
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

      {selectedReport !== "ranking" && (
        <div className="border rounded-lg p-6 bg-card space-y-6 max-w-2xl">
          <h3 className="font-medium text-sm flex items-center gap-2">
            {selectedReport === "ficha_ponto" ? "📋 Ficha de Ponto do Motorista" :
             selectedReport === "alteracoes_manuais" ? "🛡️ Relatório de Alterações Manuais" :
             "⚠️ Relatório de Ausência de Marcações"}
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
