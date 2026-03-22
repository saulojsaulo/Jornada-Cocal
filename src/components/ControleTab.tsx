import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, RefreshCw, Plus, Pencil, Trash2 } from "lucide-react";
import { useJourneyStore } from "@/context/JourneyContext";
import { Vehicle, Journey, JourneyCalculation, STATUS_LABELS, STATUS_ROW_CLASSES, VehicleStatus, MacroNumber, MacroEvent } from "@/types/journey";
import { calculateJourneyForDate, calculateInterjornada, buildTimeline, formatMinutes, getJourneyForDate } from "@/lib/journeyEngine";
import TimelineBar from "./TimelineBar";
import TelemetryBar from "./TelemetryBar";
import SummaryCards from "./SummaryCards";
import StatusBadge from "./StatusBadge";
import MacroEditDialog from "./MacroEditDialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface VehicleRowData {
  vehicle: Vehicle;
  journeys: Journey[];
  todayJourney: Journey | null;
  prevJourney: Journey | null;
  calc: JourneyCalculation | null;
  lastEventTime: Date | null;
  continuousDrivingMinutes: number;
}

export default function ControleTab() {
  const { vehicles, events, getVehicleJourneys, selectedDate, folgaVehicles, toggleFolga, vehiclePositions, getDayMark } = useJourneyStore();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showPrevDay, setShowPrevDay] = useState<Record<string, boolean>>({});
  const [sortField, setSortField] = useState<string>("vehicle");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterGestores, setFilterGestores] = useState<Set<string>>(new Set());
  const [filterAlertType, setFilterAlertType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  // Update `now` every 30 seconds so journey calculations stay fresh
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(interval);
  }, []);

  const rows = useMemo<VehicleRowData[]>(() => {
    return vehicles.map((v) => {
      const journeys = getVehicleJourneys(v.id);
      
      const todayJourney = getJourneyForDate(journeys, selectedDate, now);

      // Jornada anterior real para cálculo de interjornada
      const prevJourney = todayJourney
        ? (() => {
            const previous = journeys
              .filter((j) => j.id !== todayJourney.id && j.startTime.getTime() < todayJourney.startTime.getTime())
              .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
            return previous.length > 0 ? previous[previous.length - 1] : null;
          })()
        : null;

      let calc: JourneyCalculation | null = null;
      let lastEventTime: Date | null = null;
      let continuousDrivingMinutes = 0;

      if (todayJourney) {
        calc = calculateJourneyForDate(todayJourney, selectedDate, now);
        const inter = calculateInterjornada(prevJourney, todayJourney);
        calc.interjournadaAlert = inter.alert;
        calc.interjournadaMinutes = inter.minutes;

        const sortedMacros = [...todayJourney.macros].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        );
        const lastMacro = sortedMacros.length > 0
          ? sortedMacros[sortedMacros.length - 1]
          : null;

        if (lastMacro) lastEventTime = lastMacro.createdAt;

        // Calculate continuous driving: time since last drive-resume macro without a pause
        // Drive-resume macros: M1 (start), M4 (end meal), M6 (end rest), M10 (end complement)
        const driveResumeMacros = [1, 4, 6, 10];
        const pauseStartMacros = [2, 3, 5, 9]; // M2 end, M3 meal, M5 rest, M9 complement
        let lastDriveStart: Date | null = null;
        for (const m of sortedMacros) {
          if (driveResumeMacros.includes(m.macroNumber)) {
            lastDriveStart = m.createdAt;
          } else if (pauseStartMacros.includes(m.macroNumber)) {
            lastDriveStart = null;
          }
        }
        if (lastDriveStart && calc.status === "em_jornada") {
          continuousDrivingMinutes = (now.getTime() - lastDriveStart.getTime()) / 60000;
        }
      }

      return { vehicle: v, journeys, todayJourney, prevJourney, calc, lastEventTime, continuousDrivingMinutes };
    });
  }, [vehicles, getVehicleJourneys, selectedDate, now]);

  // Get unique gestor names for filter
  const gestorList = useMemo(() => {
    const names = new Set<string>();
    for (const row of rows) {
      if (row.vehicle.gestorName) names.add(row.vehicle.gestorName);
    }
    return Array.from(names).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    let r = rows;

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      r = r.filter((row) => {
        const numOnly = row.vehicle.name.replace(/\D/g, "");
        return (
          numOnly.includes(q) ||
          row.vehicle.name.toLowerCase().includes(q) ||
          (row.vehicle.driverName && row.vehicle.driverName.toLowerCase().includes(q)) ||
          (row.vehicle.gestorName && row.vehicle.gestorName.toLowerCase().includes(q))
        );
      });
    }

    if (filterStatus === "alertas") {
      r = r.filter((row) => row.calc && (row.calc.mealAlert || row.calc.overtimeMinutes > 0));
    } else if (filterStatus !== "all") {
      r = r.filter((row) => {
        if (filterStatus === "em_folga") {
          const mark = getDayMark(row.vehicle.id, selectedDate);
          return folgaVehicles.has(row.vehicle.id) || (mark && mark.type === "folga");
        }
        return (row.calc?.status || "em_interjornada") === filterStatus;
      });
    }

    // Alert type filter
    if (filterAlertType === "refeicao") {
      r = r.filter((row) => row.calc?.mealAlert);
    } else if (filterAlertType === "interjornada_8h") {
      r = r.filter((row) => row.calc?.interjournadaAlert === "critical");
    } else if (filterAlertType === "interjornada_11h") {
      r = r.filter((row) => {
        if (!row.calc?.interjournadaMinutes) return false;
        return row.calc.interjournadaMinutes >= 480 && row.calc.interjournadaMinutes < 660;
      });
    } else if (filterAlertType === "direcao_5h30") {
      r = r.filter((row) => row.continuousDrivingMinutes >= 330);
    }

    // Gestor filter
    if (filterGestores.size > 0) {
      r = r.filter((row) => row.vehicle.gestorName && filterGestores.has(row.vehicle.gestorName));
    }

    r.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "vehicle": {
          const numA = parseInt(a.vehicle.name.replace(/\D/g, "")) || 0;
          const numB = parseInt(b.vehicle.name.replace(/\D/g, "")) || 0;
          cmp = numA - numB;
          break;
        }
        case "gestor": cmp = (a.vehicle.gestorName || "").localeCompare(b.vehicle.gestorName || ""); break;
        case "status": cmp = (a.calc?.status || "").localeCompare(b.calc?.status || ""); break;
        case "jornada": cmp = (a.calc?.netMinutes || 0) - (b.calc?.netMinutes || 0); break;
        case "extras": cmp = (a.calc?.overtimeMinutes || 0) - (b.calc?.overtimeMinutes || 0); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return r;
  }, [rows, filterStatus, filterAlertType, filterGestores, sortField, sortDir, searchQuery, folgaVehicles, getDayMark, selectedDate]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  };

  const SortHeader = ({ field, children, className = "" }: { field: string; children: React.ReactNode; className?: string }) => (
    <th
      className={`px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground select-none whitespace-nowrap ${className}`}
      onClick={() => handleSort(field)}
    >
      {children} {sortField === field && (sortDir === "asc" ? "↑" : "↓")}
    </th>
  );

  return (
    <div className="space-y-3">
      {/* Summary Cards */}
      <SummaryCards activeFilter={filterStatus} onFilterChange={(f) => setFilterStatus(f)} />

      {/* Filters Bar */}
      <div className="flex flex-wrap gap-2 items-center bg-muted/30 rounded-md px-3 py-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar veículo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Status filter */}
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="text-xs border rounded-md px-2 py-1.5 bg-card text-foreground"
        >
          <option value="all">Todos Status</option>
          <option value="em_jornada">Em Jornada</option>
          <option value="em_refeicao">Em Refeição</option>
          <option value="em_repouso">Em Repouso</option>
          <option value="em_complemento">Em Complemento</option>
          <option value="em_interjornada">Em Interjornada</option>
          <option value="em_folga">Em Folga</option>
        </select>

        {/* Gestor filter */}
        {gestorList.length > 0 && (
          <select
            value={filterGestores.size === 0 ? "all" : filterGestores.size === 1 ? Array.from(filterGestores)[0] : "_multi"}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "all") setFilterGestores(new Set());
              else setFilterGestores(new Set([val]));
            }}
            className="text-xs border rounded-md px-2 py-1.5 bg-card text-foreground max-w-[180px]"
          >
            <option value="all">Todos Gestores</option>
            {gestorList.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        )}

        {/* Sort */}
        <select
          value={sortField}
          onChange={(e) => { setSortField(e.target.value); setSortDir("asc"); }}
          className="text-xs border rounded-md px-2 py-1.5 bg-card text-foreground"
        >
          <option value="vehicle">Ordenar: Frota</option>
          <option value="gestor">Ordenar: Gestor</option>
          <option value="status">Ordenar: Status</option>
          <option value="jornada">Ordenar: Jornada</option>
          <option value="extras">Ordenar: H. Extras</option>
        </select>
        <button
          onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
          className="p-1.5 border rounded-md hover:bg-card transition-colors bg-card"
          title="Inverter ordem"
        >
          <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
        </button>

        {/* Alert type filter */}
        <select
          value={filterAlertType}
          onChange={(e) => setFilterAlertType(e.target.value)}
          className="text-xs border rounded-md px-2 py-1.5 bg-card text-foreground"
        >
          <option value="all">Todos Alertas</option>
          <option value="refeicao">🍽️ Refeição</option>
          <option value="interjornada_8h">💣 Interjornada &lt; 8h</option>
          <option value="interjornada_11h">🌙 Interjornada &lt; 11h</option>
          <option value="direcao_5h30">🚛 Em Direção &gt; 05h30m</option>
        </select>

        <span className="text-[11px] text-muted-foreground ml-auto tabular-nums font-medium">{filteredRows.length} veículo(s)</span>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="w-6 px-1" />
              <SortHeader field="gestor">Gestor</SortHeader>
              <SortHeader field="vehicle">Frota</SortHeader>
              <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Motorista</th>
              <SortHeader field="status">Status</SortHeader>
              <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Última Posição</th>
              <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Data/Hora</th>
              <SortHeader field="jornada" className="text-right">Jornada</SortHeader>
              <th className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Disponível</th>
              <SortHeader field="extras" className="text-right">H. Extras</SortHeader>
              <th className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Alertas</th>
              <th className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Folga</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const isExpanded = expandedIds.has(row.vehicle.id);
              const status = row.calc?.status || "em_interjornada";

              return (
                <RowGroup
                  key={row.vehicle.id}
                  row={row}
                  isExpanded={isExpanded}
                  onToggle={() => toggleExpand(row.vehicle.id)}
                  showPrevDay={showPrevDay[row.vehicle.id] ?? true}
                  onTogglePrevDay={() => setShowPrevDay(p => ({ ...p, [row.vehicle.id]: !(p[row.vehicle.id] ?? true) }))}
                  selectedDate={selectedDate}
                  vehiclePosition={vehiclePositions.get(row.vehicle.id) || vehiclePositions.get(row.vehicle.numeroFrota) || null}
                  isFolga={folgaVehicles.has(row.vehicle.id) || !!(getDayMark(row.vehicle.id, selectedDate)?.type === "folga")}
                  dayMark={getDayMark(row.vehicle.id, selectedDate)}
                  onToggleFolga={() => toggleFolga(row.vehicle.id)}
                />
              );
            })}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={12} className="text-center py-12 text-muted-foreground">
                  Nenhum veículo encontrado. Importe um arquivo XLSX para começar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowGroup({
  row,
  isExpanded,
  onToggle,
  showPrevDay,
  onTogglePrevDay,
  selectedDate,
  vehiclePosition,
  isFolga,
  dayMark,
  onToggleFolga,
}: {
  row: VehicleRowData;
  isExpanded: boolean;
  onToggle: () => void;
  showPrevDay: boolean;
  onTogglePrevDay: () => void;
  selectedDate: string;
  vehiclePosition: { endereco: string; latitude: number | null; longitude: number | null; dataPosicao: string | null } | null;
  isFolga: boolean;
  dayMark: { type: string; reason: string } | null;
  onToggleFolga: () => void;
}) {
  const calc = row.calc;
  const hasDayMark = !!dayMark;
  const status: VehicleStatus = isFolga ? "em_folga" : (calc?.status || "em_interjornada");
  const rowClass = STATUS_ROW_CLASSES[status] || "";
  const timeline = useMemo(
    () => buildTimeline(row.journeys, selectedDate, showPrevDay),
    [row.journeys, selectedDate, showPrevDay]
  );

  const lastEventStr = row.lastEventTime
    ? `${String(row.lastEventTime.getDate()).padStart(2, "0")}/${String(row.lastEventTime.getMonth() + 1).padStart(2, "0")}, ${row.lastEventTime.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
    : "—";

  const alerts: string[] = [];
  if (calc?.mealAlert) alerts.push("🍽️");
  if (calc?.interjournadaAlert === "warning") alerts.push("🌙");
  if (calc?.interjournadaAlert === "critical") alerts.push("💣");
  if (row.continuousDrivingMinutes >= 330) alerts.push("🚛");

  return (
    <>
      <tr
        className={`border-b border-border/40 transition-colors hover:bg-muted/30 cursor-pointer ${rowClass}`}
        onClick={onToggle}
        style={{ height: "30px" }}
      >
        <td className="px-1 text-center">
          {isExpanded
            ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
            : <ChevronRight className="h-3 w-3 text-muted-foreground" />
          }
        </td>
        <td className="px-2 py-0 text-[11px] max-w-[120px] truncate" title={row.vehicle.gestorName || "—"}>{row.vehicle.gestorName || "—"}</td>
        <td className="px-2 py-0 font-bold font-mono text-xs">{row.vehicle.name.replace(/\D/g, "") || "—"}</td>
        <td className="px-2 py-0 text-[11px] max-w-[220px] truncate" title={row.vehicle.driverName || "—"}>{row.vehicle.driverName || "—"}</td>
        <td className="px-2 py-0">
          {hasDayMark ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-800 border border-yellow-300" title={dayMark.reason}>
              {dayMark.type === "folga" ? "🏖️" : dayMark.type === "falta" ? "❌" : dayMark.type === "atestado" ? "🏥" : "🚫"} {dayMark.type.charAt(0).toUpperCase() + dayMark.type.slice(1)}
            </span>
          ) : (
            <StatusBadge status={status} size="sm" />
          )}
        </td>
        <td
          className="px-2 py-0 text-[11px] max-w-[280px] truncate"
          title={vehiclePosition?.endereco || "—"}
          onClick={(e) => {
            e.stopPropagation();
            if (vehiclePosition?.latitude != null && vehiclePosition?.longitude != null) {
              window.open(`https://www.google.com/maps?q=${vehiclePosition.latitude},${vehiclePosition.longitude}`, "_blank");
            }
          }}
        >
          {vehiclePosition ? (
            <span className={vehiclePosition.latitude != null ? "text-primary hover:underline cursor-pointer" : "text-muted-foreground"}>
              📍 {vehiclePosition.endereco}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-2 py-0 text-[11px] text-muted-foreground whitespace-nowrap">
          {vehiclePosition?.dataPosicao
            ? new Date(vehiclePosition.dataPosicao).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
            : "—"}
        </td>
        <td className="px-2 py-0 font-mono text-[11px] font-semibold text-right tabular-nums">{calc ? formatMinutes(calc.netMinutes) : "00:00"}</td>
        <td className="px-2 py-0 font-mono text-[11px] font-bold text-status-journey text-right tabular-nums">{calc ? formatMinutes(calc.remainingMinutes) : "12:00"}</td>
        <td className="px-2 py-0 font-mono text-[11px] text-right tabular-nums">
          {calc && calc.overtimeMinutes > 0 ? (
            <span className="text-destructive font-bold">{formatMinutes(calc.overtimeMinutes)}</span>
          ) : (
            <span className="text-muted-foreground">00:00</span>
          )}
        </td>
        <td className="px-2 py-0 text-center text-sm leading-none">
          {alerts.length > 0 ? alerts.join(" ") : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-2 py-0 text-center" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isFolga}
            onChange={onToggleFolga}
            className="rounded h-3 w-3"
            title="Marcar como folga"
          />
        </td>
      </tr>

      {isExpanded && (
        <tr className={`border-b border-border/40 ${rowClass}`}>
          <td colSpan={12} className="px-4 py-3">
            <ExpandedDetails
              row={row}
              calc={calc}
              timeline={timeline}
              showPrevDay={showPrevDay}
              onTogglePrevDay={onTogglePrevDay}
              selectedDate={selectedDate}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandedDetails({
  row,
  calc,
  timeline,
  showPrevDay,
  onTogglePrevDay,
  selectedDate,
}: {
  row: VehicleRowData;
  calc: JourneyCalculation | null;
  timeline: any[];
  showPrevDay: boolean;
  onTogglePrevDay: () => void;
  selectedDate: string;
}) {
  const totalPauses = calc ? calc.mealMinutes + calc.restMinutes + calc.complementMinutes : 0;
  const { events, refreshData } = useJourneyStore();

  // Previous journey's Macro 2 end time
  const prevJourneyEndTime = useMemo(() => {
    if (!row.prevJourney) return null;
    const macro2 = row.prevJourney.macros
      .filter(m => m.macroNumber === 2)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return macro2.length > 0 ? macro2[0].createdAt : null;
  }, [row.prevJourney]);

  // Complemento Pendente: if interval between prev M2 and current M1 < 11h, show difference
  const complementoPendente = useMemo(() => {
    if (!prevJourneyEndTime || !row.todayJourney) return null;
    const intervalMs = row.todayJourney.startTime.getTime() - prevJourneyEndTime.getTime();
    const intervalMinutes = intervalMs / 60000;
    if (intervalMinutes < 660) { // < 11h
      return 660 - intervalMinutes; // missing minutes to reach 11h
    }
    return null;
  }, [prevJourneyEndTime, row.todayJourney]);

  // Tempo Para Abrir Jornada: only when status is "em_interjornada"
  const tempoParaAbrirJornada = useMemo(() => {
    const status = calc?.status || "em_interjornada";
    if (status !== "em_interjornada") return null;
    
    // Find the last Macro 2 of the current or previous journey
    let lastMacro2Time: Date | null = null;
    
    // Check current journey first
    if (row.todayJourney?.endTime) {
      lastMacro2Time = row.todayJourney.endTime;
    } else if (prevJourneyEndTime) {
      lastMacro2Time = prevJourneyEndTime;
    }
    
    if (!lastMacro2Time) return null;
    
    const now = new Date();
    const elapsedMs = now.getTime() - lastMacro2Time.getTime();
    const elapsedMinutes = elapsedMs / 60000;
    
    const remaining8h = Math.max(0, 480 - elapsedMinutes); // 8h = 480min
    const remaining11h = Math.max(0, 660 - elapsedMinutes); // 11h = 660min
    
    return { remaining8h, remaining11h };
  }, [calc?.status, row.todayJourney, prevJourneyEndTime]);

  const resolveEndereco = useMemo(() => {
    const hasAddress = (value: string | null | undefined): value is string =>
      typeof value === "string" && value.trim().length > 0;

    const exact = new Map<string, string>();
    const byMinuteMacro = new Map<string, string>();
    const byMinute = new Map<string, string>();

    for (const evt of events) {
      if (evt.vehicleId !== row.vehicle.id) continue;
      if (!hasAddress(evt.endereco)) continue;

      const endereco = evt.endereco.trim();
      const exactKey = `${evt.vehicleId}_${evt.macroNumber}_${evt.createdAt.getTime()}`;
      if (!exact.has(exactKey)) exact.set(exactKey, endereco);

      const minute = Math.floor(evt.createdAt.getTime() / 60000);
      const minuteMacroKey = `${evt.vehicleId}_${evt.macroNumber}_${minute}`;
      if (!byMinuteMacro.has(minuteMacroKey)) byMinuteMacro.set(minuteMacroKey, endereco);

      const minuteKey = `${evt.vehicleId}_${minute}`;
      if (!byMinute.has(minuteKey)) byMinute.set(minuteKey, endereco);
    }

    return (event: { vehicleId: string; macroNumber: number; createdAt: Date; endereco?: string | null }) => {
      if (hasAddress(event.endereco)) return event.endereco.trim();

      const exactKey = `${event.vehicleId}_${event.macroNumber}_${event.createdAt.getTime()}`;
      const minute = Math.floor(event.createdAt.getTime() / 60000);

      return (
        exact.get(exactKey) ??
        byMinuteMacro.get(`${event.vehicleId}_${event.macroNumber}_${minute}`) ??
        byMinute.get(`${event.vehicleId}_${minute}`) ??
        null
      );
    };
  }, [events, row.vehicle.id]);

  return (
    <div className="space-y-2.5">
      {/* Row 1: All top metrics */}
      {calc && (
        <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
          <div className="bg-card rounded-md border border-border px-2.5 py-1.5 border-l-[3px] border-l-primary">
            <p className="text-[10px] text-muted-foreground leading-tight">Tempo Para Abrir Jornada</p>
            <div className="flex gap-3 mt-0.5">
              <div>
                <p className={`text-xs font-mono font-bold tabular-nums ${tempoParaAbrirJornada ? "text-foreground" : "text-muted-foreground"}`}>
                  {tempoParaAbrirJornada ? formatMinutes(Math.round(tempoParaAbrirJornada.remaining8h)) : "00:00"}
                </p>
                <p className="text-[9px] text-muted-foreground leading-tight">Fracionamento</p>
              </div>
              <div>
                <p className={`text-xs font-mono font-bold tabular-nums ${tempoParaAbrirJornada ? "text-foreground" : "text-muted-foreground"}`}>
                  {tempoParaAbrirJornada ? formatMinutes(Math.round(tempoParaAbrirJornada.remaining11h)) : "00:00"}
                </p>
                <p className="text-[9px] text-muted-foreground leading-tight">Sem Fracionamento</p>
              </div>
            </div>
          </div>
          <MetricCard label="Fim Jornada Anterior" value={prevJourneyEndTime ? prevJourneyEndTime.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"} />
          <MetricCard label="Jornada Bruta" value={formatMinutes(calc.grossMinutes)} />
          <MetricCard label="Total Pausas" value={formatMinutes(totalPauses)} />
          <MetricCard label="Jornada Líquida" value={formatMinutes(calc.netMinutes)} highlight="primary" />
          <MetricCard label="Horas Extras" value={formatMinutes(calc.overtimeMinutes)} highlight={calc.overtimeMinutes > 0 ? "danger" : undefined} />
          <MetricCard label="Limite 12h" value={formatMinutes(calc.remainingMinutes)} />
        </div>
      )}

      {/* Row 2: Pause breakdown */}
      {calc && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <PauseCard icon="🍽️" label="Refeição" value={formatMinutes(calc.mealMinutes)} color="bg-status-meal" />
          <PauseCard icon="🛏️" label="Repouso" value={formatMinutes(calc.restMinutes)} color="bg-status-rest" />
          <PauseCard icon="⚡" label="Complemento" value={formatMinutes(calc.complementMinutes)} color="bg-status-complement" />
          <PauseCard icon="⏳" label="Complemento Pendente" value={complementoPendente != null ? formatMinutes(Math.round(complementoPendente)) : "00:00"} color="bg-alert-warning" />
        </div>
      )}



      {/* Timeline */}
      <div>
        <h4 className="text-[11px] font-semibold text-muted-foreground mb-1">Linha do Tempo (24h)</h4>
        <TimelineBar
          segments={timeline}
          showPreviousDay={showPrevDay}
          onTogglePreviousDay={onTogglePrevDay}
        />

        {/* Telemetry */}
        <TelemetryBar
          vehicleCode={row.vehicle.id}
          date={selectedDate}
          macro1Time={row.todayJourney?.startTime ?? null}
        />
      </div>

      {/* Macro list */}
      {row.todayJourney && (
        <MacroList
          journey={row.todayJourney}
          vehicleCode={row.vehicle.id}
          resolveEndereco={resolveEndereco}
          onMacroChanged={() => refreshData()}
        />
      )}
    </div>
  );
}

function MacroList({
  journey,
  vehicleCode,
  resolveEndereco,
  onMacroChanged,
}: {
  journey: Journey;
  vehicleCode: string;
  resolveEndereco: (event: { vehicleId: string; macroNumber: number; createdAt: Date; endereco?: string | null }) => string | null;
  onMacroChanged: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"insert" | "edit" | "delete">("insert");
  const [selectedMacro, setSelectedMacro] = useState<MacroEvent | null>(null);

  const journeyMacros = useMemo(
    () => [...journey.macros].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    [journey.macros]
  );

  const handleSaveOverride = async (data: {
    action: "insert" | "edit" | "delete";
    macroNumber?: MacroNumber;
    eventTime?: string;
    reason: string;
    originalEventId?: string;
    originalMacroNumber?: number;
    originalEventTime?: string;
  }) => {
    const { data: userData } = await supabase.auth.getUser();

    const { error } = await (supabase as any)
      .from("macro_overrides")
      .insert({
        vehicle_code: Number(vehicleCode),
        original_event_id: data.originalEventId || null,
        action: data.action,
        macro_number: data.macroNumber || null,
        event_time: data.eventTime || null,
        original_macro_number: data.originalMacroNumber || null,
        original_event_time: data.originalEventTime || null,
        reason: data.reason,
        created_by: userData?.user?.id || null,
      });

    if (error) {
      toast.error("Erro ao salvar alteração: " + error.message);
      throw error;
    }

    toast.success(
      data.action === "insert" ? "Macro inserida com sucesso" :
      data.action === "edit" ? "Macro editada com sucesso" :
      "Macro excluída com sucesso"
    );
    onMacroChanged();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-[11px] font-semibold text-muted-foreground">Linha do Tempo</h4>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px] gap-1"
          onClick={() => {
            setDialogMode("insert");
            setSelectedMacro(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-3 w-3" /> Inserir Macro
        </Button>
      </div>
      <div className="space-y-0.5">
        {journeyMacros.length === 0 ? (
          <div className="text-[11px] text-muted-foreground bg-card rounded border border-border/70 px-2 py-1.5">
            Nenhuma macro registrada para esta jornada.
          </div>
        ) : (
          journeyMacros.map((m) => {
            const hasCoords = m.latitude != null && m.longitude != null;
            const mapsUrl = hasCoords
              ? `https://www.google.com/maps?q=${m.latitude},${m.longitude}`
              : null;
            const enderecoExibicao = resolveEndereco(m);
            const isManual = (m as any).isManual;

            return (
              <div key={m.id} className={`flex items-center gap-2 text-[11px] bg-card rounded border px-2 py-1 ${isManual ? "border-primary/40 bg-primary/5" : "border-border/70"}`}>
                <MacroIcon macroNumber={m.macroNumber} />
                <div className="flex-1 min-w-0 truncate">
                  <span className="font-medium">{getMacroLabel(m.macroNumber)}</span>
                  {isManual && <span className="text-primary ml-1 text-[9px]">✏️ manual</span>}
                  {enderecoExibicao && (
                    <span className="text-muted-foreground ml-1"> 📍 {enderecoExibicao}</span>
                  )}
                  {mapsUrl && (
                    <span className="ml-1">
                      {" — "}
                      <a
                        href={mapsUrl}
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
                  <button
                    className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    title="Editar macro"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedMacro(m);
                      setDialogMode("edit");
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="Excluir macro"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedMacro(m);
                      setDialogMode("delete");
                      setDialogOpen(true);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <MacroEditDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        mode={dialogMode}
        vehicleCode={vehicleCode}
        initialMacroNumber={selectedMacro?.macroNumber}
        initialDateTime={selectedMacro?.createdAt}
        originalEventId={selectedMacro?.id}
        onConfirm={handleSaveOverride}
      />
    </div>
  );
}

function MetricCard({ label, value, highlight }: { label: string; value: string; highlight?: "primary" | "danger" }) {
  const valueColor = highlight === "primary"
    ? "text-primary"
    : highlight === "danger"
    ? "text-destructive"
    : "text-foreground";

  const borderColor = highlight === "primary"
    ? "border-l-primary"
    : highlight === "danger"
    ? "border-l-destructive"
    : "border-l-border";

  return (
    <div className={`bg-card rounded-md border border-border px-2.5 py-1.5 border-l-[3px] ${borderColor}`}>
      <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
      <p className={`text-xs font-mono font-bold ${valueColor} tabular-nums`}>{value}</p>
    </div>
  );
}

function PauseCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2 bg-card rounded-md border border-border px-2.5 py-1.5">
      <div className={`w-1 h-6 rounded-full ${color}`} />
      <div>
        <p className="text-[10px] text-muted-foreground flex items-center gap-1 leading-tight">
          <span>{icon}</span> {label}
        </p>
        <p className="text-xs font-mono font-bold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function MacroIcon({ macroNumber }: { macroNumber: number }) {
  const colors: Record<number, string> = {
    1: "bg-status-journey",
    2: "bg-status-end",
    3: "bg-status-meal",
    4: "bg-status-meal",
    5: "bg-status-rest",
    6: "bg-status-rest",
    9: "bg-status-complement",
    10: "bg-status-complement",
  };
  return <span className={`w-2.5 h-2.5 rounded-full inline-block ${colors[macroNumber] || "bg-muted"}`} />;
}

function getMacroLabel(macroNumber: number): string {
  const labels: Record<number, string> = {
    1: "Início de Jornada",
    2: "Fim de Jornada",
    3: "Início de Refeição",
    4: "Fim de Refeição",
    5: "Início de Repouso",
    6: "Fim de Repouso",
    9: "Início Complemento Interjornada",
    10: "Fim Complemento Interjornada",
  };
  return labels[macroNumber] || `Macro ${macroNumber}`;
}
