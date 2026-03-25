import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { MacroNumber } from "@/types/journey";
import { buildJourneys, calculateJourney } from "@/lib/journeyEngine";
import { Printer, Download } from "lucide-react";

const COMPANY_NAME = "Empresa de Transportes";
const JORNADA_NORMAL_MINUTES = 480; // 08:00

const DIAS_ABREV = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const FERIADOS_FIXOS = [
  "01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25",
];

function isFeriado(dateStr: string) { return FERIADOS_FIXOS.includes(dateStr.substring(5)); }
function isDomingo(dateStr: string) { return new Date(dateStr + "T12:00:00").getDay() === 0; }

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateBR(dateStr: string): string {
  const [y, mo, d] = dateStr.split("-");
  const diaAbrev = DIAS_ABREV[new Date(dateStr + "T12:00:00").getDay()];
  return `${d}/${mo}/${y.slice(2)} ${diaAbrev}`;
}

function formatTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function fmtMin(mins: number, showDash = true): string {
  if (mins <= 0) return showDash ? "—" : "00:00";
  const h = Math.floor(mins / 60);
  const m = Math.floor(mins % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ──────────────────────────────────────────────────────────────────────
// Telemetry helpers — from telemetria_sync.pontos JSON
// pontos is an array of {position_time, speed, ignition}
// ──────────────────────────────────────────────────────────────────────
interface TelPonto { position_time: string; speed: number; ignition: number; }

function calcDrivingMinutes(pontos: TelPonto[], journeyStart: Date | null, journeyEnd: Date | null): { driving: number; stopped: number } {
  if (!journeyStart || !journeyEnd || pontos.length < 2) return { driving: 0, stopped: 0 };
  let driving = 0, stopped = 0;
  const sorted = [...pontos]
    .filter(p => p.position_time != null)
    .sort((a, b) => (a.position_time || "").localeCompare(b.position_time || ""));
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    const ta = new Date(a.position_time), tb = new Date(b.position_time);
    if (tb <= journeyStart || ta >= journeyEnd) continue;
    const segStart = ta < journeyStart ? journeyStart : ta;
    const segEnd = tb > journeyEnd ? journeyEnd : tb;
    const mins = (segEnd.getTime() - segStart.getTime()) / 60000;
    if (a.ignition === 1 && a.speed > 0) driving += mins;
    else stopped += mins;
  }
  return { driving: Math.round(driving), stopped: Math.round(stopped) };
}

// ──────────────────────────────────────────────────────────────────────
// Night time (22:00–06:00) within a window
// ──────────────────────────────────────────────────────────────────────
function nightMinutes(start: Date, end: Date): number {
  if (start >= end) return 0;
  let mins = 0;
  const cur = new Date(start);
  while (cur < end) {
    const h = cur.getHours();
    if (h >= 22 || h < 6) mins++;
    cur.setTime(cur.getTime() + 60000);
  }
  return mins;
}

// ──────────────────────────────────────────────────────────────────────
// DayRow — all computed fields per day
// ──────────────────────────────────────────────────────────────────────
interface DayRow {
  date: string;
  tipo: string; // "Trabalho" | "Folga" | "Falta" | "Atestado" | "Afastamento"
  inicioJornada: string; // M1 time string
  fimJornada: string;   // M2 time string
  jornadaNormal: number; // 480 if Trabalho, 0 otherwise
  jornadaDiaria: number; // net minutes
  emDirecao: number;
  semDirecao: number;
  totalRefeicao: number;
  totalRepouso: number;
  faltas: number;
  // HE — stub, to be defined
  he50Diurna: number;
  he50Noturna: number;
  he100Diurna: number;
  he100Noturna: number;
  horaNot: number;
  isDomingoFeriado: boolean;
  hasJourney: boolean;
  startTime: Date | null;
  endTime: Date | null;
}

const TIPO_LABELS: Record<string, string> = {
  folga: "Folga",
  falta: "Falta",
  atestado: "Atestado",
  afastamento: "Afastamento",
};

export default function FichaPontoReport() {
  const [searchParams] = useSearchParams();
  const motoristaNome = searchParams.get("motorista_nome") || "";
  const motoristaCpf = searchParams.get("motorista_cpf") || "";
  const startDate = searchParams.get("start") || "";
  const endDate = searchParams.get("end") || "";
  const vehicleCodesStr = searchParams.get("vehicle_codes") || "";
  const driverSenha = searchParams.get("senha") || "";

  const [rows, setRows] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => { loadReport(); }, []);

  const loadReport = async () => {
    setLoading(true);
    try {
      const vehicleCodes = vehicleCodesStr.split(",").filter(Boolean);
      const today = fmt(new Date());

      // Clip end date to today
      const clippedEnd = endDate > today ? today : endDate;

      // Start from the first day of the month of startDate
      const startD = new Date(startDate + "T12:00:00");
      const monthStart = fmt(new Date(startD.getFullYear(), startD.getMonth(), 1));

      const startISO = new Date(monthStart + "T00:00:00").toISOString();
      const endExtended = new Date(clippedEnd + "T00:00:00");
      endExtended.setDate(endExtended.getDate() + 2);
      const endISO = endExtended.toISOString();

      // Build OR filter
      // Step 1: if we have no vehicle_codes from URL but have a senha, discover
      // vehicle_codes from autotrac_eventos where raw_data MessageText contains _senha
      let resolvedCodes = [...vehicleCodes];
      if (resolvedCodes.length === 0 && driverSenha) {
        const { data: discoverData } = await (supabase as any)
          .from("autotrac_eventos")
          .select("vehicle_code")
          .gte("message_time", new Date(monthStart + "T00:00:00").toISOString())
          .lte("message_time", endISO)
          .ilike("raw_data->>MessageText", `%_${driverSenha}%`);
        if (discoverData?.length) {
          const codeSet = new Set<string>();
          for (const row of discoverData) codeSet.add(String(row.vehicle_code));
          resolvedCodes = Array.from(codeSet);
        }
      }

      if (resolvedCodes.length === 0) { setRows([]); setLoading(false); return; }

      // Step 2: fetch all events for those vehicle_codes
      // The query will now use the resolvedCodes for filtering
      let allEvents: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data: page, error } = await (supabase as any)
          .from("autotrac_eventos")
          .select("*")
          .in("vehicle_code", resolvedCodes.map(Number))
          .gte("message_time", startISO)
          .lte("message_time", endISO)
          .order("message_time", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!page || page.length === 0) break;
        allEvents = allEvents.concat(page);
        if (page.length < pageSize) break;
        from += pageSize;
      }

      // If driver has a senha, filter events to only those belonging to this driver
      // (in case the vehicle was used by multiple drivers)
      if (driverSenha) {
        allEvents = allEvents.filter((e: any) => {
          const msgText = e.raw_data?.MessageText ? String(e.raw_data.MessageText) : "";
          const match = msgText.match(/^_(\w+)/);
          const extracted = match ? match[1] : null;
          if (extracted && extracted !== driverSenha) return false;
          return true;
        });
      }

      // Overrides
      const { data: overridesData } = await (supabase as any)
        .from("macro_overrides")
        .select("*")
        .in("vehicle_code", resolvedCodes.length > 0 ? resolvedCodes.map(Number) : [0]);

      // Determine which vehicle codes were used per day (for telemetry)
      const vehicleCodesUsedByDay = new Map<string, Set<number>>();

      const VALID_MACROS = new Set([1, 2, 3, 4, 5, 6, 9, 10]);

      let mapped = allEvents
        .filter((e: any) => VALID_MACROS.has(e.macro_number))
        .map((e: any) => {
          const dt = new Date(e.message_time);
          const dk = toDateKey(dt);
          if (!vehicleCodesUsedByDay.has(dk)) vehicleCodesUsedByDay.set(dk, new Set());
          vehicleCodesUsedByDay.get(dk)!.add(Number(e.vehicle_code));
          return {
            id: e.id,
            vehicleId: String(e.vehicle_code),
            macroNumber: e.macro_number as MacroNumber,
            createdAt: dt,
            dataJornada: dk,
            driverId: "unknown",
            driverName: null as string | null,
            endereco: e.landmark || null as string | null,
            latitude: e.latitude ? Number(e.latitude) : null as number | null,
            longitude: e.longitude ? Number(e.longitude) : null as number | null,
            journeyId: undefined as string | undefined,
          };
        });

      // Apply overrides
      const dayMarksMap = new Map<string, string>();
      if (overridesData?.length) {
        const deletedIds = new Set<string>();
        const editedIds = new Map<string, any>();
        const dayMarkActions = new Set(["folga", "falta", "atestado", "afastamento"]);
        for (const ov of overridesData) {
          if (ov.action === "delete" && ov.original_event_id) deletedIds.add(ov.original_event_id);
          else if (ov.action === "edit" && ov.original_event_id) editedIds.set(ov.original_event_id, ov);
          else if (ov.action === "insert" && ov.event_time) {
            const dt = new Date(ov.event_time);
            const dk = toDateKey(dt);
            if (!vehicleCodesUsedByDay.has(dk)) vehicleCodesUsedByDay.set(dk, new Set());
            vehicleCodesUsedByDay.get(dk)!.add(Number(ov.vehicle_code));
            mapped.push({ id: `manual_${ov.id}`, vehicleId: String(ov.vehicle_code), macroNumber: ov.macro_number as MacroNumber, createdAt: dt, dataJornada: dk });
          } else if (dayMarkActions.has(ov.action) && ov.event_time) {
            dayMarksMap.set(`${ov.vehicle_code}_${toDateKey(new Date(ov.event_time))}`, ov.action);
          }
        }
        mapped = mapped.filter(e => !deletedIds.has(e.id)).map(e => {
          const edit = editedIds.get(e.id);
          if (!edit) return e;
          const dt = new Date(edit.event_time);
          return { ...e, macroNumber: edit.macro_number as MacroNumber, createdAt: dt, dataJornada: toDateKey(dt) };
        });
      }

      const journeys = buildJourneys(mapped);

      // Collect all distinct dates in range that have events or day marks
      const datesWithActivity = new Set<string>();
      for (const j of journeys) datesWithActivity.add(j.date);
      for (const [key] of dayMarksMap) {
        const parts = key.split("_");
        const dateKey = parts[parts.length - 1];
        datesWithActivity.add(dateKey);
      }

      // Build sorted list of all days from monthStart..clippedEnd
      const allDays: string[] = [];
      const cur = new Date(monthStart + "T12:00:00");
      const endD = new Date(clippedEnd + "T12:00:00");
      while (cur <= endD) { allDays.push(toDateKey(cur)); cur.setDate(cur.getDate() + 1); }

      // Fetch telemetry from telemetria_sync for vehicle codes used
      const allVehicleCodesUsed = new Set<number>();
      for (const [, codes] of vehicleCodesUsedByDay) for (const c of codes) allVehicleCodesUsed.add(c);

      const telByVehicleDay = new Map<string, TelPonto[]>(); // key: `${vc}_${date}`
      if (allVehicleCodesUsed.size > 0) {
        const { data: telData } = await supabase
          .from("telemetria_sync")
          .select("vehicle_code, data_jornada, pontos")
          .in("vehicle_code", Array.from(allVehicleCodesUsed))
          .gte("data_jornada", monthStart)
          .lte("data_jornada", clippedEnd);
        if (telData) {
          for (const row of telData) {
            const key = `${row.vehicle_code}_${row.data_jornada}`;
            const pontos = Array.isArray(row.pontos) ? row.pontos as TelPonto[] : [];
            telByVehicleDay.set(key, pontos);
          }
        }
      }

      // Build day rows
      const dayRows: DayRow[] = [];
      for (const dateKey of allDays) {
        const domFeriado = isDomingo(dateKey) || isFeriado(dateKey);
        const dateJourneys = journeys.filter(j => j.date === dateKey);

        // Day mark: check vehicle codes for this date
        let dayMark: string | null = null;
        const usedCodes = vehicleCodesUsedByDay.get(dateKey) || new Set();
        for (const vc of [...usedCodes, ...vehicleCodes.map(Number)]) {
          const m = dayMarksMap.get(`${vc}_${dateKey}`);
          if (m) { dayMark = m; break; }
        }

        if (dayMark) {
          dayRows.push({
            date: dateKey, tipo: TIPO_LABELS[dayMark] || dayMark,
            inicioJornada: "—", fimJornada: "—",
            jornadaNormal: 0, jornadaDiaria: 0,
            emDirecao: 0, semDirecao: 0,
            totalRefeicao: 0, totalRepouso: 0,
            faltas: dayMark === "falta" ? JORNADA_NORMAL_MINUTES : 0,
            he50Diurna: 0, he50Noturna: 0, he100Diurna: 0, he100Noturna: 0, horaNot: 0,
            isDomingoFeriado: domFeriado, hasJourney: false,
            startTime: null, endTime: null,
          });
          continue;
        }

        if (dateJourneys.length === 0) {
          // No activity — only include if it's a weekday (not Sunday/holiday) to show falta
          if (!domFeriado) {
            dayRows.push({
              date: dateKey, tipo: "Falta",
              inicioJornada: "—", fimJornada: "—",
              jornadaNormal: 0, jornadaDiaria: 0,
              emDirecao: 0, semDirecao: 0,
              totalRefeicao: 0, totalRepouso: 0,
              faltas: JORNADA_NORMAL_MINUTES,
              he50Diurna: 0, he50Noturna: 0, he100Diurna: 0, he100Noturna: 0, horaNot: 0,
              isDomingoFeriado: false, hasJourney: false,
              startTime: null, endTime: null,
            });
          }
          continue;
        }

        const journey = dateJourneys[dateJourneys.length - 1];
        const macros = [...journey.macros].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const calc = calculateJourney(journey, journey.endTime || new Date());

        const m1 = macros.find(m => m.macroNumber === 1);
        const m2 = macros.find(m => m.macroNumber === 2);
        const m3 = macros.find(m => m.macroNumber === 3);
        const m4 = macros.find(m => m.macroNumber === 4);

        // All M5/M6 pairs for total repouso
        const m5s = macros.filter(m => m.macroNumber === 5);
        const m6s = macros.filter(m => m.macroNumber === 6);
        let totalRepouso = 0;
        for (let i = 0; i < Math.min(m5s.length, m6s.length); i++) {
          const diff = (m6s[i].createdAt.getTime() - m5s[i].createdAt.getTime()) / 60000;
          if (diff > 0) totalRepouso += diff;
        }

        const totalRefeicao = (m3 && m4) ? Math.max(0, (m4.createdAt.getTime() - m3.createdAt.getTime()) / 60000) : 0;
        const netMinutes = calc.netMinutes;
        const faltaMinutes = netMinutes < JORNADA_NORMAL_MINUTES ? JORNADA_NORMAL_MINUTES - netMinutes : 0;

        // Telemetry for this day
        const vcSet = vehicleCodesUsedByDay.get(dateKey) || new Set();
        let driving = 0, stopped = 0;
        for (const vc of vcSet) {
          const pontos = telByVehicleDay.get(`${vc}_${dateKey}`) || [];
          const seg = calcDrivingMinutes(pontos, journey.startTime, journey.endTime || new Date());
          driving += seg.driving;
          stopped += seg.stopped;
        }

        // Night hours during net journey
        let horaNot = 0;
        if (m1 && m2) horaNot = nightMinutes(m1.createdAt, m2.createdAt);

        // HE — stubs: 50% for workdays, 100% for sunday/holiday
        const overtime = calc.overtimeMinutes;
        const he50 = domFeriado ? 0 : overtime;
        const he100 = domFeriado ? overtime : 0;
        // Diurna/Noturna split: proportional to night % of net
        const nightPct = netMinutes > 0 ? horaNot / netMinutes : 0;
        const he50Noturna = Math.round(he50 * nightPct);
        const he50Diurna = he50 - he50Noturna;
        const he100Noturna = Math.round(he100 * nightPct);
        const he100Diurna = he100 - he100Noturna;

        dayRows.push({
          date: dateKey, tipo: "Trabalho",
          inicioJornada: m1 ? formatTime(m1.createdAt) : "—",
          fimJornada: m2 ? formatTime(m2.createdAt) : "—",
          jornadaNormal: JORNADA_NORMAL_MINUTES,
          jornadaDiaria: netMinutes,
          emDirecao: driving, semDirecao: stopped,
          totalRefeicao: Math.round(totalRefeicao), totalRepouso: Math.round(totalRepouso),
          faltas: faltaMinutes,
          he50Diurna, he50Noturna, he100Diurna, he100Noturna, horaNot,
          isDomingoFeriado: domFeriado, hasJourney: true,
          startTime: journey.startTime, endTime: journey.endTime,
        });
      }

      setRows(dayRows);
    } catch (err: any) {
      console.error("Erro ao gerar relatório:", err);
    } finally {
      setLoading(false);
    }
  };

  const totals = useMemo(() => ({
    normal: rows.filter(r => r.tipo === "Trabalho").length * JORNADA_NORMAL_MINUTES,
    noturnas: rows.reduce((s, r) => s + r.horaNot, 0),
    he50: rows.reduce((s, r) => s + r.he50Diurna + r.he50Noturna, 0),
    he50Not: rows.reduce((s, r) => s + r.he50Noturna, 0),
    he100: rows.reduce((s, r) => s + r.he100Diurna + r.he100Noturna, 0),
    he100Not: rows.reduce((s, r) => s + r.he100Noturna, 0),
    faltas: rows.reduce((s, r) => s + r.faltas, 0),
  }), [rows]);

  const mesLabel = useMemo(() => {
    if (!startDate) return "";
    const d = new Date(startDate + "T12:00:00");
    return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  }, [startDate]);

  const handleDownloadPDF = async () => {
    setDownloading(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const element = document.getElementById("ficha-ponto-content");
      if (!element) return;
      // A4 landscape @ 96dpi ≈ 1122px wide, minus 2×6mm margins ≈ 1076px
      const CONTENT_W = 1076;
      await html2pdf().set({
        margin: [6, 6, 6, 6],
        filename: `ficha-ponto-${motoristaNome.replace(/\s+/g, "_")}-${startDate}.pdf`,
        image: { type: "jpeg", quality: 1.0 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          letterRendering: true,
          logging: false,
          windowWidth: CONTENT_W,
          width: CONTENT_W,
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "landscape", compress: true },
        pagebreak: { mode: ["css", "legacy"] },
      } as any).from(element).save();
    } catch (err) { console.error(err); }
    finally { setDownloading(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">Carregando relatório...</p></div>;
  }

  const tdC = "border border-gray-300 px-1 py-0.5 text-center";
  const tdL = "border border-gray-300 px-1 py-0.5";
  const thC = "border border-gray-400 px-1 py-0.5 text-center bg-gray-200";
  const thL = "border border-gray-400 px-1 py-0.5 text-left bg-gray-200";

  return (
    <div className="min-h-screen bg-white text-black p-3 print:p-0">
      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        @page { size: A4 landscape; margin: 6mm; }
        #ficha-ponto-content {
          width: 1076px;
          box-sizing: border-box;
        }
        #ficha-ponto-content table {
          border-collapse: collapse;
          width: 100%;
          table-layout: auto;
        }
        #ficha-ponto-content th, #ficha-ponto-content td {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: clip;
          font-size: 7pt;
          line-height: 1.4;
          vertical-align: middle;
          padding: 2px 2px;
        }
      `}</style>

      {/* Action buttons */}
      <div className="no-print fixed top-4 right-4 z-50 flex gap-2">
        <button onClick={handleDownloadPDF} disabled={downloading}
          className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-xs font-medium shadow disabled:opacity-50">
          <Download className="h-3 w-3" />{downloading ? "Gerando..." : "Baixar PDF"}
        </button>
        <button onClick={() => window.print()}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs font-medium shadow">
          <Printer className="h-3 w-3" />Imprimir
        </button>
      </div>

      <div id="ficha-ponto-content">
      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-black pb-2 mb-2">
        <img src="/logo-jornada.png" alt="Logo" style={{ height: "40px", objectFit: "contain" }} />
        <div className="text-center">
          <h1 className="text-sm font-bold uppercase tracking-wide">Ficha de Ponto Simplificada</h1>
          <p className="text-[9px] text-gray-500 uppercase tracking-widest">Controle de Jornada do Motorista</p>
        </div>
        <div className="text-right">
          <p className="text-[9px] text-gray-500">Competência:</p>
          <p className="text-[10px] font-semibold capitalize">{mesLabel}</p>
        </div>
      </div>

      {/* Driver Info */}
      <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
        <div><strong>Motorista:</strong> {motoristaNome}</div>
        <div><strong>CPF:</strong> {motoristaCpf || "Não informado"}</div>
        <div><strong>Período:</strong> {mesLabel}</div>
      </div>

      {/* Main Table */}
      <table style={{ fontSize: "7pt", lineHeight: "1.2", width: "100%" }}>
        <colgroup>
          <col style={{ width: "7%" }} />{/* Data */}
          <col style={{ width: "5.5%" }} />{/* Tipo */}
          <col style={{ width: "4.5%" }} /><col style={{ width: "4.5%" }} />{/* Inicio/Fim */}
          <col style={{ width: "5%" }} /><col style={{ width: "5%" }} />{/* Normal/Diária */}
          <col style={{ width: "5%" }} /><col style={{ width: "5%" }} />{/* Em/Sem Direção */}
          <col style={{ width: "5%" }} /><col style={{ width: "5%" }} />{/* Refeição/Repouso */}
          <col style={{ width: "4.5%" }} />{/* Faltas */}
          <col style={{ width: "4.5%" }} /><col style={{ width: "4.5%" }} /><col style={{ width: "4.5%" }} />{/* HE 50% */}
          <col style={{ width: "4.5%" }} /><col style={{ width: "4.5%" }} /><col style={{ width: "4.5%" }} />{/* HE 100% */}
          <col style={{ width: "5%" }} />{/* HN */}
        </colgroup>
        <thead>
          {/* Row 1 — group headers */}
          <tr>
            <th className={thL} rowSpan={2}>Data</th>
            <th className={thC} rowSpan={2}>Tipo</th>
            <th className={thC} colSpan={2}>Jornada</th>
            <th className={thC} rowSpan={2}>Jornada Normal</th>
            <th className={thC} rowSpan={2}>Jornada Diária</th>
            <th className={thC} rowSpan={2}>Em Direção</th>
            <th className={thC} rowSpan={2}>Sem Direção</th>
            <th className={thC} rowSpan={2}>Refeição</th>
            <th className={thC} rowSpan={2}>Repouso</th>
            <th className={thC} rowSpan={2}>Faltas</th>
            <th className={thC} colSpan={3}>H.E. 50%</th>
            <th className={thC} colSpan={3}>H.E. 100%</th>
            <th className={thC} rowSpan={2}>H.Not.</th>
          </tr>
          {/* Row 2 — sub-headers */}
          <tr>
            <th className={thC}>Início</th>
            <th className={thC}>Fim</th>
            <th className={thC}>Diurna</th>
            <th className={thC}>Noturna</th>
            <th className={thC}>Total</th>
            <th className={thC}>Diurna</th>
            <th className={thC}>Noturna</th>
            <th className={thC}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const bg = r.tipo === "Folga" ? "bg-green-50" : r.tipo === "Atestado" ? "bg-blue-50" : r.tipo === "Afastamento" ? "bg-purple-50" : r.tipo === "Falta" ? "bg-orange-50" : r.isDomingoFeriado ? "bg-red-50" : "";
            return (
              <tr key={r.date} className={bg}>
                <td className={tdL}>{formatDateBR(r.date)}</td>
                <td className={tdC}>{r.tipo}</td>
                <td className={tdC}>{r.inicioJornada}</td>
                <td className={tdC}>{r.fimJornada}</td>
                <td className={tdC}>{r.jornadaNormal > 0 ? "08:00" : ""}</td>
                <td className={tdC}>{r.jornadaDiaria > 0 ? fmtMin(r.jornadaDiaria) : "—"}</td>
                <td className={tdC}>{r.emDirecao > 0 ? fmtMin(r.emDirecao) : "—"}</td>
                <td className={tdC}>{r.semDirecao > 0 ? fmtMin(r.semDirecao) : "—"}</td>
                <td className={tdC}>{r.totalRefeicao > 0 ? fmtMin(r.totalRefeicao) : "—"}</td>
                <td className={tdC}>{r.totalRepouso > 0 ? fmtMin(r.totalRepouso) : "—"}</td>
                <td className={`${tdC} font-bold text-amber-700`}>{r.faltas > 0 ? fmtMin(r.faltas) : ""}</td>
                <td className={tdC}>{r.he50Diurna > 0 ? fmtMin(r.he50Diurna) : "—"}</td>
                <td className={tdC}>{r.he50Noturna > 0 ? fmtMin(r.he50Noturna) : "—"}</td>
                <td className={`${tdC} font-bold text-orange-600`}>{(r.he50Diurna + r.he50Noturna) > 0 ? fmtMin(r.he50Diurna + r.he50Noturna) : "—"}</td>
                <td className={tdC}>{r.he100Diurna > 0 ? fmtMin(r.he100Diurna) : "—"}</td>
                <td className={tdC}>{r.he100Noturna > 0 ? fmtMin(r.he100Noturna) : "—"}</td>
                <td className={`${tdC} font-bold text-red-600`}>{(r.he100Diurna + r.he100Noturna) > 0 ? fmtMin(r.he100Diurna + r.he100Noturna) : "—"}</td>
                <td className={`${tdC} text-blue-700`}>{r.horaNot > 0 ? fmtMin(r.horaNot) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Totals */}
      <div className="mt-3 border-2 border-black rounded p-2">
        <h3 className="font-bold text-[9px] mb-1 uppercase">Totalizadores do Período</h3>
        <div className="grid grid-cols-7 gap-1 text-[8px]">
          {[
            { label: "Horas Normais", value: fmtMin(totals.normal), cls: "" },
            { label: "Horas Noturnas", value: fmtMin(totals.noturnas), cls: "text-blue-700" },
            { label: "H.E. 50%", value: fmtMin(totals.he50), cls: "text-orange-600" },
            { label: "H.E. 50% Noturnas", value: fmtMin(totals.he50Not), cls: "text-orange-500" },
            { label: "H.E. 100%", value: fmtMin(totals.he100), cls: "text-red-600" },
            { label: "H.E. 100% Noturnas", value: fmtMin(totals.he100Not), cls: "text-red-500" },
            { label: "Horas Faltas", value: fmtMin(totals.faltas), cls: "text-amber-700" },
          ].map(({ label, value, cls }) => (
            <div key={label} className="text-center border rounded p-1">
              <div className="text-[7px] text-gray-500">{label}</div>
              <div className={`font-bold font-mono text-xs ${cls}`}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Declaration + Signatures */}
      <div className="mt-4 border border-gray-400 rounded p-2" style={{ fontSize: "7pt" }}>
        <p className="text-justify leading-snug">
          Reconheço que essas anotações de jornada são verdadeiras e foram preenchidas exclusivamente por mim por meios eletrônicos como teclado do rastreador, aplicativo no celular e totem físico nas dependências da empresa, tal como determinado nas leis trabalhistas vigentes.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-16 px-8">
        <div className="text-center">
          <div className="border-t border-black pt-1">
            <p className="text-xs font-medium">{motoristaNome}</p>
            <p className="text-[9px] text-gray-500">Assinatura do Motorista</p>
          </div>
        </div>
        <div className="text-center">
          <div className="border-t border-black pt-1">
            <p className="text-xs font-medium">{COMPANY_NAME}</p>
            <p className="text-[9px] text-gray-500">Assinatura da Empresa</p>
          </div>
        </div>
      </div>

      <div className="mt-3 text-center text-[7px] text-gray-400 no-print">
        Gerado em {new Date().toLocaleString("pt-BR")}
      </div>
      </div>{/* end ficha-ponto-content */}
    </div>

  );
}
