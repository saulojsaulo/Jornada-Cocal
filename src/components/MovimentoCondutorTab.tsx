import { useState, useEffect, useMemo } from "react";
import { Search, ChevronDown, ChevronRight, Plus, Pencil, Trash2, Calendar, UserSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MacroNumber, MACRO_LABELS, MacroEvent, Journey, STATUS_ROW_CLASSES, VehicleStatus } from "@/types/journey";
import { buildJourneys, calculateJourney, formatMinutes, toDateKey, buildTimeline } from "@/lib/journeyEngine";
import MacroEditDialog from "./MacroEditDialog";
import DayMarkDialog from "./DayMarkDialog";
import StatusBadge from "./StatusBadge";
import TimelineBar from "./TimelineBar";
import TelemetryBar from "./TelemetryBar";
import { useJourneyStore } from "@/context/JourneyContext";
import { useDriverHistory } from "@/hooks/useDriverHistory";

interface Motorista {
  id: string;
  nome: string;
  cpf: string | null;
  senha?: string;
}

interface Cadastro {
  veiculo_id: string;
  nome_veiculo: string;
  numero_frota: string;
  motorista_nome: string | null;
  motorista_id: string | null;
}

type PeriodoType = "mes_atual" | "mes_anterior" | "personalizado";

const VALID_MACROS = new Set([1, 2, 3, 4, 5, 6, 9, 10]);

export type DayMarkType = "folga" | "falta" | "atestado" | "afastamento";
export const DAY_MARK_LABELS: Record<DayMarkType, string> = {
  folga: "Folga",
  falta: "Falta",
  atestado: "Atestado",
  afastamento: "Afastamento",
};
export const DAY_MARK_ICONS: Record<DayMarkType, string> = {
  folga: "🏖️",
  falta: "❌",
  atestado: "🏥",
  afastamento: "🚫",
};

interface DayData {
  date: string;
  journeys: Journey[];
  allEvents: MacroEvent[];
  dayMark: { type: DayMarkType; reason: string; id: string } | null;
}

export default function MovimentoCondutorTab() {
  const [dayMarkVehicleCode, setDayMarkVehicleCode] = useState<string>("");
  
  const { motoristas, cadastros, autotracVehicles, refreshData } = useJourneyStore();
  const [historyParams, setHistoryParams] = useState<{senha?: string, start?: string, end?: string}>({});
  const { data: historyData, isLoading: historyLoading, error: historyError } = useDriverHistory(historyParams.senha, historyParams.start, historyParams.end);

  // Base data is now in useJourneyStore

  const getDateRange = (): { start: string; end: string } | null => {
    const now = new Date();
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (periodo === "mes_atual") {
      return { start: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), end: fmt(now) };
    }
    if (periodo === "mes_anterior") {
      return { start: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: fmt(new Date(now.getFullYear(), now.getMonth(), 0)) };
    }
    if (!dataInicio || !dataFim) return null;
    return { start: dataInicio, end: dataFim };
  };

  const handleSearch = () => {
    if (!searchText.trim() && !searchFrota.trim()) {
      toast.error("Informe o nome do motorista ou a frota");
      return;
    }

    let found: Motorista | null = null;
    if (searchFrota.trim()) {
      const cad = cadastros.find(c => c.numero_frota === searchFrota.trim() || c.veiculo_id === searchFrota.trim());
      if (cad?.motorista_id) found = motoristas.find((m: any) => m.id === cad.motorista_id) || null;
      if (!found && cad?.motorista_nome) found = motoristas.find((m: any) => m.nome === cad.motorista_nome) || null;
    }

    if (!found && searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      const matches = motoristas.filter((m: any) => m.nome.toLowerCase().includes(q));
      if (matches.length === 1) found = matches[0] as unknown as Motorista;
      else if (matches.length > 1) {
        found = matches[0] as unknown as Motorista;
        toast.info(`${matches.length} motoristas encontrados, mostrando: ${found.nome}`);
      }
    }

    if (!found) { toast.error("Motorista não encontrado"); return; }
    setSelectedMotorista(found);
    
    const range = getDateRange();
    if (!range) { toast.error("Selecione o período"); return; }
    
    setHistoryParams({
      senha: found.senha,
      start: new Date(range.start + "T00:00:00").toISOString(),
      end: new Date(range.end + "T23:59:59").toISOString()
    });
  };

  // Effect to map historyData when it arrives
  useEffect(() => {
    if (historyData && selectedMotorista) {
      console.log(`[API] Processando ${historyData.events.length} eventos históricos...`);
      const range = getDateRange();
      if (!range) return;

      const driver = selectedMotorista;
      const allEvents = historyData.events;
      const overridesData = historyData.overrides;

      const vcSet = new Set<string>();
      for (const e of allEvents) {
        if (e.vehicle_code) vcSet.add(String(e.vehicle_code));
      }
      const vehicleCodes = Array.from(vcSet);

      const mappedEvents: MacroEvent[] = allEvents
        .filter((e: any) => VALID_MACROS.has(e.macro_number))
        .map((e: any) => ({
          id: e.id,
          vehicleId: String(e.vehicle_code),
          macroNumber: e.macro_number as MacroNumber,
          createdAt: new Date(e.message_time),
          endereco: e.landmark || null,
          latitude: e.latitude ? Number(e.latitude) : null,
          longitude: e.longitude ? Number(e.longitude) : null,
          dataJornada: toDateKey(new Date(e.message_time)),
        }));

      const deduped: MacroEvent[] = [];
      const keys = new Set<string>();
      for (const evt of mappedEvents) {
        const key = `${evt.vehicleId}_${evt.macroNumber}_${evt.createdAt.getTime()}`;
        if (!keys.has(key)) { keys.add(key); deduped.push(evt); }
      }

      let finalEvents = [...deduped];
      const dayMarksMap = new Map<string, { type: DayMarkType; reason: string; id: string }>();

      if (overridesData && overridesData.length > 0) {
        const deletedIds = new Set<string>();
        const editedIds = new Map<string, any>();

        for (const ov of overridesData) {
          if (ov.action === "delete" && ov.original_event_id) {
            deletedIds.add(ov.original_event_id);
          } else if (ov.action === "edit" && ov.original_event_id) {
            editedIds.set(ov.original_event_id, ov);
          } else if (ov.action === "insert" && ov.macro_number) {
            finalEvents.push({
              id: `manual_${ov.id}`,
              vehicleId: String(ov.vehicle_code),
              macroNumber: ov.macro_number as MacroNumber,
              createdAt: new Date(ov.event_time),
              endereco: null, latitude: null, longitude: null,
              dataJornada: toDateKey(new Date(ov.event_time)),
              isManual: true,
            } as any);
          } else if (["folga", "falta", "atestado", "afastamento"].includes(ov.action)) {
            const markDate = ov.event_time ? toDateKey(new Date(ov.event_time)) : null;
            if (markDate) {
              const dk = (ov.vehicle_code === 0 && ov.original_event_id) ? ov.original_event_id : ov.vehicle_code;
              dayMarksMap.set(`${dk}_${markDate}`, { type: ov.action as DayMarkType, reason: ov.reason || "", id: ov.id });
            }
          }
        }

        finalEvents = finalEvents.filter(e => !deletedIds.has(e.id));
        finalEvents = finalEvents.map(e => {
          const edit = editedIds.get(e.id);
          if (edit) return { ...e, macroNumber: edit.macro_number as MacroNumber, createdAt: new Date(edit.event_time), dataJornada: toDateKey(new Date(edit.event_time)), isManual: true } as any;
          return e;
        });
      }

      // Grouping logic... (identical to old one)
      const journeysByDate = new Map<string, Journey[]>();
      const eventsByDate = new Map<string, MacroEvent[]>();
      const byVehicle = new Map<string, MacroEvent[]>();
      for (const e of finalEvents) {
        if (!byVehicle.has(e.vehicleId)) byVehicle.set(e.vehicleId, []);
        byVehicle.get(e.vehicleId)!.push(e);
        const dk = e.dataJornada || toDateKey(e.createdAt);
        if (!eventsByDate.has(dk)) eventsByDate.set(dk, []);
        eventsByDate.get(dk)!.push(e);
      }

      for (const [, evts] of byVehicle) {
        const journeys = buildJourneys(evts);
        for (const j of journeys) {
          if (!journeysByDate.has(j.date)) journeysByDate.set(j.date, []);
          journeysByDate.get(j.date)!.push(j);
        }
      }

      const days: DayData[] = [];
      const current = new Date(range.start + "T00:00:00");
      const end = new Date(range.end + "T23:59:59");
      while (current <= end) {
        const dateKey = toDateKey(current);
        const dayJourneys = journeysByDate.get(dateKey) || [];
        const dayEvents = eventsByDate.get(dateKey) || [];
        let dayMark: DayData["dayMark"] = null;
        if (driver) {
           const dMark = dayMarksMap.get(`${driver.id}_${dateKey}`);
           if (dMark) dayMark = dMark;
        }
        if (!dayMark) {
          for (const vc of vehicleCodes) {
            const mark = dayMarksMap.get(`${vc}_${dateKey}`);
            if (mark) { dayMark = mark; break; }
          }
        }
        days.push({ date: dateKey, journeys: dayJourneys, allEvents: dayEvents, dayMark });
        current.setDate(current.getDate() + 1);
      }

      setDayDataList(days);
    }
  }, [historyData, selectedMotorista]);

  const loadDriverData = useCallback((driver: Motorista) => {
    const range = getDateRange();
    if (!range) return;
    setHistoryParams({
      senha: driver.senha,
      start: new Date(range.start + "T00:00:00").toISOString(),
      end: new Date(range.end + "T23:59:59").toISOString()
    });
  }, []);

  const toggleDay = (date: string) => {
    setExpandedDays(prev => { const n = new Set(prev); n.has(date) ? n.delete(date) : n.add(date); return n; });
  };

  const handleSaveOverride = async (data: {
    action: "insert" | "edit" | "delete";
    macroNumber?: MacroNumber;
    eventTime?: string;
    reason: string;
    originalEventId?: string;
    originalMacroNumber?: number;
    originalEventTime?: string;
  }) => {
    toast.info("Salvando alteração via API...");
    const { data: { user } } = await supabase.auth.getUser();

    const payload = {
      vehicle_code: Number(activeVehicleCode),
      original_event_id: data.originalEventId || null,
      action: data.action,
      macro_number: data.macroNumber || null,
      event_time: data.eventTime || null,
      original_macro_number: data.originalMacroNumber || null,
      original_event_time: data.originalEventTime || null,
      reason: data.reason,
      created_by: user?.id || null,
    };

    const { error } = await supabase.functions.invoke("dashboard-api", {
      method: "POST",
      body: { action: "upsert_override", payload }
    });

    if (error) { toast.error("Erro ao salvar alteração via API: " + (error.message || error)); throw error; }
    toast.success(data.action === "insert" ? "Macro inserida" : data.action === "edit" ? "Macro editada" : "Macro excluída");
    if (selectedMotorista) loadDriverData(selectedMotorista);
  };

  const handleSaveDayMark = async (markData: { type: DayMarkType; reason: string; date: string; vehicleCode: string }) => {
    toast.info("Salvando marcação via API...");
    const { data: { user } } = await supabase.auth.getUser();

    const payload = {
      vehicle_code: 0,
      original_event_id: selectedMotorista?.id,
      action: markData.type,
      event_time: new Date(markData.date + "T12:00:00").toISOString(),
      reason: markData.reason,
      created_by: user?.id || null,
    };

    const { error } = await supabase.functions.invoke("dashboard-api", {
      method: "POST",
      body: { action: "upsert_override", payload }
    });

    if (error) { toast.error("Erro ao salvar marcação via API: " + (error.message || error)); throw error; }
    toast.success(`Dia marcado como ${DAY_MARK_LABELS[markData.type]}`);
    if (selectedMotorista) loadDriverData(selectedMotorista);
    refreshData();
  };

  const handleDeleteDayMark = async (markId: string) => {
    toast.info("Removendo marcação via API...");
    const { error } = await supabase.functions.invoke("dashboard-api", {
      method: "POST",
      body: { action: "delete_override", payload: { id: markId } }
    });

    if (error) { toast.error("Erro ao remover marcação via API: " + (error.message || error)); return; }
    toast.success("Marcação removida");
    if (selectedMotorista) loadDriverData(selectedMotorista);
    refreshData();
  };

  const driverVehicleCodes = useMemo(() => {
    if (!selectedMotorista || dayDataList.length === 0) return [];
    const codes = new Set<string>();
    for (const day of dayDataList) {
      for (const e of day.allEvents) codes.add(e.vehicleId);
    }
    return Array.from(codes);
  }, [selectedMotorista, dayDataList]);

  const JORNADA_NORMAL = 480;

  const totals = useMemo(() => {
    let totalJornada = 0, totalExtras = 0, totalFaltas = 0, totalFolgas = 0, totalAtestados = 0, totalAfastamentos = 0;
    for (const day of dayDataList) {
      if (day.dayMark) {
        if (day.dayMark.type === "folga") totalFolgas++;
        else if (day.dayMark.type === "falta") totalFaltas += JORNADA_NORMAL;
        else if (day.dayMark.type === "atestado") totalAtestados++;
        else if (day.dayMark.type === "afastamento") totalAfastamentos++;
        continue;
      }
      for (const j of day.journeys) {
        const calc = calculateJourney(j);
        totalJornada += calc.netMinutes;
        totalExtras += calc.overtimeMinutes;
        if (calc.netMinutes < JORNADA_NORMAL && j.endTime) totalFaltas += JORNADA_NORMAL - calc.netMinutes;
      }
    }
    return { totalJornada, totalExtras, totalFaltas, totalFolgas, totalAtestados, totalAfastamentos };
  }, [dayDataList]);

  return (
    <div className="space-y-6">
      {/* Search Filters */}
      <div className="border rounded-lg p-4 bg-card space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Nome do Motorista</Label>
            <Input placeholder="Digite parte do nome..." value={searchText} onChange={(e) => setSearchText(e.target.value)} className="h-9 text-xs" onKeyDown={(e) => e.key === "Enter" && handleSearch()} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Frota</Label>
            <Input placeholder="Número da frota..." value={searchFrota} onChange={(e) => setSearchFrota(e.target.value)} className="h-9 text-xs" onKeyDown={(e) => e.key === "Enter" && handleSearch()} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Período</Label>
            <Select value={periodo} onValueChange={(v) => setPeriodo(v as PeriodoType)}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mes_atual" className="text-xs">Mês Atual</SelectItem>
                <SelectItem value="mes_anterior" className="text-xs">Mês Anterior</SelectItem>
                <SelectItem value="personalizado" className="text-xs">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={handleSearch} className="gap-2 h-9 w-full" disabled={loading}>
              <Search className="h-4 w-4" />
              Buscar
            </Button>
          </div>
        </div>
        {periodo === "personalizado" && (
          <div className="grid grid-cols-2 gap-3 max-w-sm">
            <div className="space-y-1.5">
              <Label className="text-xs">Data Início</Label>
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="h-9 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Data Fim</Label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="h-9 text-xs" />
            </div>
          </div>
        )}
      </div>

      {/* Driver info & Summary */}
      {selectedMotorista && (
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-semibold text-sm">{selectedMotorista.nome}</h4>
              {selectedMotorista.cpf && <p className="text-xs text-muted-foreground">CPF: {selectedMotorista.cpf}</p>}
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center">
              <SummaryPill label="Jornada Total" value={formatMinutes(totals.totalJornada)} />
              <SummaryPill label="Horas Extras" value={formatMinutes(totals.totalExtras)} highlight="danger" />
              <SummaryPill label="Horas Falta" value={formatMinutes(totals.totalFaltas)} highlight="warning" />
              <SummaryPill label="Folgas" value={String(totals.totalFolgas)} />
              <SummaryPill label="Atestados" value={String(totals.totalAtestados)} />
              <SummaryPill label="Afastamentos" value={String(totals.totalAfastamentos)} />
            </div>
          </div>
        </div>
      )}

      {historyLoading && <p className="text-sm text-muted-foreground">Carregando dados históricos via API...</p>}
      {historyError && <p className="text-sm text-destructive">Erro ao carregar histórico: {(historyError as Error).message}</p>}

      {/* Day Grid — same visual style as ControleTab */}
      {!loading && selectedMotorista && dayDataList.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-border/70 bg-muted/40">
              <tr>
                <th className="w-6 px-1" />
                <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-muted-foreground whitespace-nowrap">Data</th>
                <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-muted-foreground whitespace-nowrap">Dia</th>
                <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-muted-foreground whitespace-nowrap">Status</th>
                <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-muted-foreground whitespace-nowrap">Início</th>
                <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-muted-foreground whitespace-nowrap">Fim</th>
                <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-muted-foreground whitespace-nowrap">Jornada Bruta</th>
                <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-muted-foreground whitespace-nowrap">Pausas</th>
                <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-muted-foreground whitespace-nowrap">Jornada Líquida</th>
                <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-muted-foreground whitespace-nowrap">Disponível</th>
                <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-muted-foreground whitespace-nowrap">H. Extras</th>
                <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-muted-foreground whitespace-nowrap">Faltas</th>
                <th className="px-2 py-1.5 text-center text-[11px] font-semibold text-muted-foreground whitespace-nowrap">Ações</th>
              </tr>
            </thead>
            <tbody>
              {dayDataList.map((day) => (
                <DayRow
                  key={day.date}
                  day={day}
                  isExpanded={expandedDays.has(day.date)}
                  onToggle={() => toggleDay(day.date)}
                  driverVehicleCodes={driverVehicleCodes}
                  onInsertMacro={(vc) => { setActiveVehicleCode(vc); setActiveDayDate(day.date); setSelectedMacroEvt(null); setMacroDialogMode("insert"); setMacroDialogOpen(true); }}
                  onEditMacro={(m, vc) => { setActiveVehicleCode(vc); setSelectedMacroEvt(m); setMacroDialogMode("edit"); setMacroDialogOpen(true); }}
                  onDeleteMacro={(m, vc) => { setActiveVehicleCode(vc); setSelectedMacroEvt(m); setMacroDialogMode("delete"); setMacroDialogOpen(true); }}
                  onAddDayMark={(vc) => { setDayMarkVehicleCode(vc); setDayMarkDate(day.date); setDayMarkDialogOpen(true); }}
                  onDeleteDayMark={handleDeleteDayMark}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <MacroEditDialog
        open={macroDialogOpen}
        onClose={() => setMacroDialogOpen(false)}
        mode={macroDialogMode}
        vehicleCode={activeVehicleCode}
        initialMacroNumber={selectedMacroEvt?.macroNumber}
        initialDateTime={selectedMacroEvt?.createdAt || (activeDayDate ? new Date(activeDayDate + "T08:00:00") : undefined)}
        originalEventId={selectedMacroEvt?.id}
        onConfirm={handleSaveOverride}
      />

      <DayMarkDialog
        open={dayMarkDialogOpen}
        onClose={() => setDayMarkDialogOpen(false)}
        date={dayMarkDate}
        vehicleCode={dayMarkVehicleCode}
        onConfirm={handleSaveDayMark}
      />
    </div>
  );
}

/* ──────────────── Day Row ──────────────── */

function DayRow({
  day, isExpanded, onToggle, driverVehicleCodes,
  onInsertMacro, onEditMacro, onDeleteMacro, onAddDayMark, onDeleteDayMark,
}: {
  day: DayData;
  isExpanded: boolean;
  onToggle: () => void;
  driverVehicleCodes: string[];
  onInsertMacro: (vc: string) => void;
  onEditMacro: (m: MacroEvent, vc: string) => void;
  onDeleteMacro: (m: MacroEvent, vc: string) => void;
  onAddDayMark: (vc: string) => void;
  onDeleteDayMark: (id: string) => void;
}) {
  const JORNADA_NORMAL = 480;
  const primaryVc = driverVehicleCodes[0] || "";
  const d = new Date(day.date + "T12:00:00");
  const weekday = d.toLocaleDateString("pt-BR", { weekday: "short" });
  const dateStr = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const isSunday = d.getDay() === 0;

  // Compute journey metrics for the row
  const metrics = useMemo(() => {
    if (day.dayMark) {
      return {
        status: `${DAY_MARK_ICONS[day.dayMark.type]} ${DAY_MARK_LABELS[day.dayMark.type]}`,
        statusType: day.dayMark.type as string,
        startTime: null as string | null,
        endTime: null as string | null,
        grossMins: 0, pauseMins: 0, netMins: 0, remainMins: 0, extraMins: 0,
        faltaMins: day.dayMark.type === "falta" ? JORNADA_NORMAL : 0,
      };
    }

    if (day.journeys.length === 0) {
      return {
        status: "Sem Jornada", statusType: "none",
        startTime: null, endTime: null,
        grossMins: 0, pauseMins: 0, netMins: 0, remainMins: 0, extraMins: 0, faltaMins: 0,
      };
    }

    let grossMins = 0, pauseMins = 0, netMins = 0, extraMins = 0, remainMins = 0;
    let startTime: string | null = null;
    let endTime: string | null = null;
    let isOpen = false;
    let statusType: VehicleStatus = "em_interjornada";

    for (const j of day.journeys) {
      const calc = calculateJourney(j);
      grossMins += calc.grossMinutes;
      pauseMins += calc.mealMinutes + calc.restMinutes + calc.complementMinutes;
      netMins += calc.netMinutes;
      extraMins += calc.overtimeMinutes;
      remainMins += calc.remainingMinutes;
      if (!startTime) startTime = j.startTime.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      if (j.endTime) endTime = j.endTime.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      if (!j.endTime) { isOpen = true; statusType = calc.status; }
    }

    const faltaMins = netMins < JORNADA_NORMAL && !isOpen ? JORNADA_NORMAL - netMins : 0;
    const status = isOpen ? "Em Jornada" : day.journeys.every(j => j.endTime) ? "Jornada Completa" : "Em Jornada";

    return {
      status, statusType: isOpen ? statusType : "em_interjornada",
      startTime, endTime: isOpen ? "Em aberto" : endTime,
      grossMins, pauseMins, netMins, remainMins, extraMins, faltaMins,
    };
  }, [day]);

  // Row background color matching ControleTab style
  const rowBg = day.dayMark
    ? day.dayMark.type === "folga" ? "bg-blue-50 dark:bg-blue-950/20"
      : day.dayMark.type === "falta" ? "bg-orange-50 dark:bg-orange-950/20"
      : day.dayMark.type === "atestado" ? "bg-purple-50 dark:bg-purple-950/20"
      : "bg-red-50 dark:bg-red-950/20"
    : isSunday ? "bg-red-50/30 dark:bg-red-950/10"
    : "";

  const statusRowClass = !day.dayMark && day.journeys.length > 0
    ? STATUS_ROW_CLASSES[metrics.statusType as VehicleStatus] || ""
    : "";

  return (
    <>
      <tr
        className={`border-b border-border/60 transition-colors hover:brightness-95 cursor-pointer ${rowBg} ${statusRowClass}`}
        onClick={onToggle}
        style={{ height: "20px" }}
      >
        <td className="px-1 text-center">
          {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        </td>
        <td className="px-2 py-0 font-mono text-[11px]">{dateStr}</td>
        <td className="px-2 py-0 text-[11px] capitalize">{weekday}</td>
        <td className="px-2 py-0">
          {day.dayMark ? (
            <span className="text-[11px] font-medium">{metrics.status}</span>
          ) : day.journeys.length > 0 ? (
            <StatusBadge status={metrics.statusType as VehicleStatus} size="sm" />
          ) : (
            <span className="text-[11px] text-muted-foreground">Sem Jornada</span>
          )}
        </td>
        <td className="px-2 py-0 font-mono text-[11px]">{metrics.startTime || "—"}</td>
        <td className="px-2 py-0 font-mono text-[11px]">{metrics.endTime || "—"}</td>
        <td className="px-2 py-0 font-mono text-[11px]">{metrics.grossMins > 0 ? formatMinutes(metrics.grossMins) : "—"}</td>
        <td className="px-2 py-0 font-mono text-[11px]">{metrics.pauseMins > 0 ? formatMinutes(metrics.pauseMins) : "—"}</td>
        <td className="px-2 py-0 font-mono text-[11px] font-semibold">{metrics.netMins > 0 ? formatMinutes(metrics.netMins) : "—"}</td>
        <td className="px-2 py-0 font-mono text-[11px] font-bold text-status-journey">{metrics.netMins > 0 ? formatMinutes(metrics.remainMins) : "—"}</td>
        <td className="px-2 py-0 font-mono text-[11px]">
          {metrics.extraMins > 0 ? <span className="text-destructive font-bold">{formatMinutes(metrics.extraMins)}</span> : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-2 py-0 font-mono text-[11px]">
          {metrics.faltaMins > 0 ? <span className="text-orange-600 dark:text-orange-400 font-bold">{formatMinutes(metrics.faltaMins)}</span> : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-2 py-0 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-center gap-0.5">
            <button className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" title="Inserir macro" onClick={() => onInsertMacro(primaryVc)}>
              <Plus className="h-3 w-3" />
            </button>
            {!day.dayMark && (
              <button className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" title="Marcar dia" onClick={() => onAddDayMark(primaryVc)}>
                <Calendar className="h-3 w-3" />
              </button>
            )}
            {day.dayMark && (
              <button className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Remover marcação" onClick={() => onDeleteDayMark(day.dayMark!.id)}>
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr className={`border-b border-border/60 ${rowBg}`}>
          <td colSpan={13} className="px-4 py-2.5">
            <ExpandedDayDetails
              day={day}
              driverVehicleCodes={driverVehicleCodes}
              onInsertMacro={onInsertMacro}
              onEditMacro={onEditMacro}
              onDeleteMacro={onDeleteMacro}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/* ──────────────── Expanded Day Details (mirrors ControleTab style) ──────────────── */

function ExpandedDayDetails({
  day, driverVehicleCodes, onInsertMacro, onEditMacro, onDeleteMacro,
}: {
  day: DayData;
  driverVehicleCodes: string[];
  onInsertMacro: (vc: string) => void;
  onEditMacro: (m: MacroEvent, vc: string) => void;
  onDeleteMacro: (m: MacroEvent, vc: string) => void;
}) {
  const [showPrevDay, setShowPrevDay] = useState(false);

  if (day.dayMark) {
    return (
      <div className="bg-muted/50 rounded-md p-3 text-sm">
        <p><strong>{DAY_MARK_ICONS[day.dayMark.type]} {DAY_MARK_LABELS[day.dayMark.type]}</strong></p>
        {day.dayMark.reason && <p className="text-xs text-muted-foreground mt-1">Motivo: {day.dayMark.reason}</p>}
        <p className="text-[10px] text-muted-foreground mt-1">✏️ Alteração manual</p>
      </div>
    );
  }

  if (day.journeys.length === 0) {
    return <div className="text-[11px] text-muted-foreground py-2">Nenhuma jornada registrada neste dia.</div>;
  }

  return (
    <div className="space-y-2">
      {day.journeys.map((journey) => {
        const calc = calculateJourney(journey);
        const totalPauses = calc.mealMinutes + calc.restMinutes + calc.complementMinutes;
        const macros = [...journey.macros].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const timeline = buildTimeline([journey], day.date, showPrevDay);

        return (
          <div key={journey.id} className="space-y-1.5">
            {/* Row 1: Metrics cards — same as ControleTab */}
            <div className="grid grid-cols-3 md:grid-cols-6 gap-1.5">
              <MetricCard label="Jornada Bruta" value={formatMinutes(calc.grossMinutes)} />
              <MetricCard label="Total Pausas" value={formatMinutes(totalPauses)} />
              <MetricCard label="Jornada Líquida" value={formatMinutes(calc.netMinutes)} highlight="primary" />
              <MetricCard label="Horas Extras" value={formatMinutes(calc.overtimeMinutes)} highlight={calc.overtimeMinutes > 0 ? "danger" : undefined} />
              <MetricCard label="Limite 12h" value={formatMinutes(calc.remainingMinutes)} />
              <MetricCard label="Início → Fim" value={`${journey.startTime.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} → ${journey.endTime ? journey.endTime.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "Aberto"}`} />
            </div>

            {/* Row 2: Pause breakdown */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
              <PauseCard icon="🍽️" label="Refeição" value={formatMinutes(calc.mealMinutes)} color="bg-status-meal" />
              <PauseCard icon="🛏️" label="Repouso" value={formatMinutes(calc.restMinutes)} color="bg-status-rest" />
              <PauseCard icon="⚡" label="Complemento" value={formatMinutes(calc.complementMinutes)} color="bg-status-complement" />
            </div>

            {/* Timeline */}
            <div>
              <h4 className="text-[11px] font-semibold text-muted-foreground mb-1">Linha do Tempo (24h)</h4>
              <TimelineBar
                segments={timeline}
                showPreviousDay={showPrevDay}
                onTogglePreviousDay={() => setShowPrevDay(!showPrevDay)}
              />
              <TelemetryBar
                vehicleCode={journey.vehicleId}
                date={day.date}
                macro1Time={journey.startTime}
              />
            </div>

            {/* Macro list */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-[11px] font-semibold text-muted-foreground">Linha do Tempo</h4>
                <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => onInsertMacro(journey.vehicleId)}>
                  <Plus className="h-3 w-3" /> Inserir Macro
                </Button>
              </div>
              <div className="space-y-0.5">
                {macros.map((m) => {
                  const isManual = (m as any).isManual;
                  return (
                    <div key={m.id} className={`flex items-center gap-2 text-[11px] bg-card rounded border px-2 py-1 ${isManual ? "border-primary/40 bg-primary/5" : "border-border/70"}`}>
                      <MacroIcon macroNumber={m.macroNumber} />
                      <div className="flex-1 min-w-0 truncate">
                        <span className="font-medium">{MACRO_LABELS[m.macroNumber]}</span>
                        {isManual && <span className="text-primary ml-1 text-[9px]">✏️ manual</span>}
                        {m.endereco && <span className="text-muted-foreground ml-1">📍 {m.endereco}</span>}
                        {m.latitude != null && m.longitude != null && (
                          <span className="ml-1">
                            {" — "}
                            <a
                              href={`https://www.google.com/maps?q=${m.latitude},${m.longitude}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline font-medium"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Ver no Mapa
                            </a>
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-muted-foreground whitespace-nowrap">
                        {m.createdAt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <div className="flex gap-0.5 ml-1">
                        <button className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" title="Editar" onClick={() => onEditMacro(m, journey.vehicleId)}>
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Excluir" onClick={() => onDeleteMacro(m, journey.vehicleId)}>
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────── Small reusable components ──────────────── */

function SummaryPill({ label, value, highlight }: { label: string; value: string; highlight?: "danger" | "warning" }) {
  const cls = highlight === "danger" ? "text-destructive" : highlight === "warning" ? "text-orange-600 dark:text-orange-400" : "";
  return (
    <div className="bg-muted/50 rounded-md px-3 py-1.5 border">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-mono font-bold ${cls}`}>{value}</p>
    </div>
  );
}

function MetricCard({ label, value, highlight }: { label: string; value: string; highlight?: "primary" | "danger" }) {
  const cls = highlight === "primary" ? "text-primary" : highlight === "danger" ? "text-destructive" : "text-foreground";
  return (
    <div className="bg-card rounded border border-border/70 px-2 py-1 shadow-sm">
      <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
      <p className={`text-xs font-mono font-bold ${cls}`}>{value}</p>
    </div>
  );
}

function PauseCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5 bg-card rounded border border-border/70 px-2 py-1 shadow-sm">
      <div className={`w-1 h-5 rounded-full ${color}`} />
      <div>
        <p className="text-[10px] text-muted-foreground flex items-center gap-1 leading-tight"><span>{icon}</span> {label}</p>
        <p className="text-xs font-mono font-bold">{value}</p>
      </div>
    </div>
  );
}

function MacroIcon({ macroNumber }: { macroNumber: number }) {
  const colors: Record<number, string> = {
    1: "bg-status-journey", 2: "bg-status-end", 3: "bg-status-meal", 4: "bg-status-meal",
    5: "bg-status-rest", 6: "bg-status-rest", 9: "bg-status-complement", 10: "bg-status-complement",
  };
  return <span className={`w-2.5 h-2.5 rounded-full inline-block ${colors[macroNumber] || "bg-muted"}`} />;
}
