import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { MacroNumber } from "@/types/journey";
import { buildJourneys, calculateJourney } from "@/lib/journeyEngine";
import { Printer, Download } from "lucide-react";

const COMPANY_NAME = "Empresa de Transportes";
const JORNADA_NORMAL_MINUTES = 480; // 08:00

const DIAS_SEMANA = ["Domingo", "Segunda-Feira", "Terça-Feira", "Quarta-Feira", "Quinta-Feira", "Sexta-Feira", "Sábado"];

const FERIADOS_FIXOS = [
  "01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25",
];

function isFeriado(dateStr: string): boolean {
  const mmdd = dateStr.substring(5);
  return FERIADOS_FIXOS.includes(mmdd);
}

function isDomingo(dateStr: string): boolean {
  return new Date(dateStr + "T12:00:00").getDay() === 0;
}

function formatTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatMinutesHHMM(mins: number): string {
  if (mins <= 0) return "00:00";
  const h = Math.floor(mins / 60);
  const m = Math.floor(mins % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDateBR(dateStr: string): string {
  const [y, mo, d] = dateStr.split("-");
  return `${d}/${mo}/${y}`;
}

function calcNightMinutes(start: Date, end: Date): number {
  if (start >= end) return 0;
  let nightMins = 0;
  const cur = new Date(start);
  while (cur < end) {
    const h = cur.getHours();
    if (h >= 22 || h < 6) nightMins += 1;
    cur.setTime(cur.getTime() + 60000);
  }
  return nightMins;
}

interface DayRow {
  date: string;
  diaSemana: string;
  inicioJornada: string;
  fimJornada: string;
  refeicaoInicio: string;
  refeicaoFim: string;
  repousoInicio: string;
  repousoFim: string;
  complementoInicio: string;
  complementoFim: string;
  totalBruto: number;
  totalLiquido: number;
  horasExtras: number;
  horasNoturnas: number;
  horasFalta: number;
  isDomingoFeriado: boolean;
  hasJourney: boolean;
  dayMark?: string | null; // folga, falta, atestado, afastamento
}

interface WeekSubtotal {
  type: "subtotal";
  weekNum: number;
  bruto: number;
  liquido: number;
  extra50: number;
  extra100: number;
  noturnas: number;
  faltas: number;
}

type TableRow = (DayRow & { type: "day" }) | WeekSubtotal;

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

      const startISO = new Date(startDate + "T00:00:00").toISOString();
      const endExtended = new Date(endDate + "T00:00:00");
      endExtended.setDate(endExtended.getDate() + 2);
      const endISO = endExtended.toISOString();

      // Build OR filter: by password and/or vehicle codes (same logic as MovimentoCondutorTab)
      const pwdFilter = driverSenha ? `driver_password.eq.${driverSenha},raw_data->>MessageText.ilike.%_${driverSenha}%` : "";
      const vehFilter = vehicleCodes.length > 0 ? `vehicle_code.in.(${vehicleCodes.join(",")})` : "";

      let orQuery = "";
      if (pwdFilter && vehFilter) orQuery = `${pwdFilter},${vehFilter}`;
      else if (pwdFilter) orQuery = pwdFilter;
      else if (vehFilter) orQuery = vehFilter;
      else { setRows([]); setLoading(false); return; }

      let allEvents: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        let q = (supabase as any)
          .from("autotrac_eventos")
          .select("*")
          .gte("message_time", startISO)
          .lte("message_time", endISO)
          .order("message_time", { ascending: true });
        q = q.or(orQuery);
        const { data: page, error } = await q.range(from, from + pageSize - 1);
        if (error) throw error;
        if (!page || page.length === 0) break;
        allEvents = allEvents.concat(page);
        if (page.length < pageSize) break;
        from += pageSize;
      }

      const { data: overridesData } = await supabase
        .from("macro_overrides")
        .select("*")
        .in("vehicle_code", vehicleCodes.length > 0 ? vehicleCodes.map(Number) : [0]);

      const VALID_MACROS = new Set([1, 2, 3, 4, 5, 6, 9, 10]);
      const toDateKey = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      let mapped = allEvents
        .filter((e: any) => VALID_MACROS.has(e.macro_number))
        .map((e: any) => ({
          id: e.id,
          vehicleId: String(e.vehicle_code),
          macroNumber: e.macro_number as MacroNumber,
          createdAt: new Date(e.message_time),
          dataJornada: toDateKey(new Date(e.message_time)),
        }));

      // Parse day marks from overrides
      const dayMarksMap = new Map<string, string>();
      
      if (overridesData && overridesData.length > 0) {
        const deletedIds = new Set<string>();
        const editedIds = new Map<string, any>();
        const dayMarkActions = new Set(["folga", "falta", "atestado", "afastamento"]);
        
        for (const ov of overridesData) {
          if (ov.action === "delete" && ov.original_event_id) deletedIds.add(ov.original_event_id);
          else if (ov.action === "edit" && ov.original_event_id) editedIds.set(ov.original_event_id, ov);
          else if (ov.action === "insert" && ov.event_time) {
            mapped.push({
              id: `manual_${ov.id}`,
              vehicleId: String(ov.vehicle_code),
              macroNumber: ov.macro_number as MacroNumber,
              createdAt: new Date(ov.event_time),
              dataJornada: toDateKey(new Date(ov.event_time)),
            });
          } else if (dayMarkActions.has(ov.action) && ov.event_time) {
            const markDate = toDateKey(new Date(ov.event_time));
            dayMarksMap.set(`${ov.vehicle_code}_${markDate}`, ov.action);
          }
        }
        mapped = mapped.filter(e => !deletedIds.has(e.id));
        mapped = mapped.map(e => {
          const edit = editedIds.get(e.id);
          if (edit) {
            return { ...e, macroNumber: edit.macro_number as MacroNumber, createdAt: new Date(edit.event_time), dataJornada: toDateKey(new Date(edit.event_time)) };
          }
          return e;
        });
      }

      const journeys = buildJourneys(mapped);
      const dayRows: DayRow[] = [];
      const current = new Date(startDate + "T12:00:00");
      const endD = new Date(endDate + "T12:00:00");

      while (current <= endD) {
        const dateKey = toDateKey(current);
        const dayJourneys = journeys.filter(j => j.date === dateKey);
        const dayOfWeek = DIAS_SEMANA[current.getDay()];
        const domFeriado = isDomingo(dateKey) || isFeriado(dateKey);

        // Check for day marks (folga, falta, atestado, afastamento)
        let dayMark: string | null = null;
        for (const vc of vehicleCodes) {
          const mark = dayMarksMap.get(`${vc}_${dateKey}`);
          if (mark) { dayMark = mark; break; }
        }

        if (dayMark) {
          // Day marked: folga/atestado/afastamento = no fault; falta = full 08:00 fault
          const isFalta = dayMark === "falta";
          dayRows.push({
            date: dateKey, diaSemana: dayOfWeek,
            inicioJornada: "—", fimJornada: "—",
            refeicaoInicio: "—", refeicaoFim: "—",
            repousoInicio: "—", repousoFim: "—",
            complementoInicio: "—", complementoFim: "—",
            totalBruto: 0, totalLiquido: 0, horasExtras: 0, horasNoturnas: 0,
            horasFalta: isFalta ? JORNADA_NORMAL_MINUTES : 0,
            isDomingoFeriado: domFeriado,
            hasJourney: false,
            dayMark,
          });
        } else if (dayJourneys.length === 0) {
          // No journey = full 08:00 fault
          dayRows.push({
            date: dateKey, diaSemana: dayOfWeek,
            inicioJornada: "—", fimJornada: "—",
            refeicaoInicio: "—", refeicaoFim: "—",
            repousoInicio: "—", repousoFim: "—",
            complementoInicio: "—", complementoFim: "—",
            totalBruto: 0, totalLiquido: 0, horasExtras: 0, horasNoturnas: 0,
            horasFalta: JORNADA_NORMAL_MINUTES,
            isDomingoFeriado: domFeriado,
            hasJourney: false,
          });
        } else {
          const journey = dayJourneys[dayJourneys.length - 1];
          const macros = [...journey.macros].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          const calc = calculateJourney(journey, journey.endTime || new Date());

          const m1 = macros.find(m => m.macroNumber === 1);
          const m2 = macros.find(m => m.macroNumber === 2);
          const m3 = macros.find(m => m.macroNumber === 3);
          const m4 = macros.find(m => m.macroNumber === 4);
          const m5 = macros.find(m => m.macroNumber === 5);
          const m6 = macros.find(m => m.macroNumber === 6);
          const m9 = macros.find(m => m.macroNumber === 9);
          const m10 = macros.find(m => m.macroNumber === 10);

          let nightMins = 0;
          let lastWorkStart: Date | null = journey.startTime;
          for (const m of macros) {
            if ([3, 5, 9].includes(m.macroNumber)) {
              if (lastWorkStart) nightMins += calcNightMinutes(lastWorkStart, m.createdAt);
              lastWorkStart = null;
            } else if ([4, 6, 10].includes(m.macroNumber)) {
              lastWorkStart = m.createdAt;
            } else if (m.macroNumber === 2) {
              if (lastWorkStart) nightMins += calcNightMinutes(lastWorkStart, m.createdAt);
              lastWorkStart = null;
            }
          }
          if (lastWorkStart && journey.endTime) {
            nightMins += calcNightMinutes(lastWorkStart, journey.endTime);
          } else if (lastWorkStart) {
            nightMins += calcNightMinutes(lastWorkStart, new Date());
          }

          // Fault = missing minutes to reach 08:00 (only when net < 480 and no overtime)
          const faltaMinutes = calc.netMinutes < JORNADA_NORMAL_MINUTES
            ? JORNADA_NORMAL_MINUTES - calc.netMinutes
            : 0;

          dayRows.push({
            date: dateKey, diaSemana: dayOfWeek,
            inicioJornada: m1 ? formatTime(m1.createdAt) : "—",
            fimJornada: m2 ? formatTime(m2.createdAt) : "—",
            refeicaoInicio: m3 ? formatTime(m3.createdAt) : "—",
            refeicaoFim: m4 ? formatTime(m4.createdAt) : "—",
            repousoInicio: m5 ? formatTime(m5.createdAt) : "—",
            repousoFim: m6 ? formatTime(m6.createdAt) : "—",
            complementoInicio: m9 ? formatTime(m9.createdAt) : "—",
            complementoFim: m10 ? formatTime(m10.createdAt) : "—",
            totalBruto: calc.grossMinutes,
            totalLiquido: calc.netMinutes,
            horasExtras: calc.overtimeMinutes,
            horasNoturnas: nightMins,
            horasFalta: faltaMinutes,
            isDomingoFeriado: domFeriado,
            hasJourney: true,
          });
        }
        current.setDate(current.getDate() + 1);
      }
      setRows(dayRows);
    } catch (err: any) {
      console.error("Erro ao gerar relatório:", err);
    } finally {
      setLoading(false);
    }
  };

  // Build table rows with weekly subtotals
  const tableRows = useMemo(() => {
    const result: TableRow[] = [];
    let weekNum = 1;
    let weekBruto = 0, weekLiquido = 0, weekExtra50 = 0, weekExtra100 = 0, weekNoturnas = 0, weekFaltas = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      result.push({ ...r, type: "day" as const });

      weekBruto += r.totalBruto;
      weekLiquido += r.totalLiquido;
      weekNoturnas += r.horasNoturnas;
      weekFaltas += r.horasFalta;
      if (r.isDomingoFeriado) weekExtra100 += r.horasExtras;
      else weekExtra50 += r.horasExtras;

      // End of week = Saturday or last day of period
      const isSaturday = new Date(r.date + "T12:00:00").getDay() === 6;
      const isLast = i === rows.length - 1;

      if (isSaturday || isLast) {
        result.push({
          type: "subtotal",
          weekNum,
          bruto: weekBruto,
          liquido: weekLiquido,
          extra50: weekExtra50,
          extra100: weekExtra100,
          noturnas: weekNoturnas,
          faltas: weekFaltas,
        });
        weekNum++;
        weekBruto = 0; weekLiquido = 0; weekExtra50 = 0; weekExtra100 = 0; weekNoturnas = 0; weekFaltas = 0;
      }
    }
    return result;
  }, [rows]);

  const totals = useMemo(() => {
    let bruto = 0, liquido = 0, extra50 = 0, extra100 = 0, noturnas = 0, faltas = 0;
    for (const r of rows) {
      bruto += r.totalBruto;
      liquido += r.totalLiquido;
      noturnas += r.horasNoturnas;
      faltas += r.horasFalta;
      if (r.isDomingoFeriado) extra100 += r.horasExtras;
      else extra50 += r.horasExtras;
    }
    return { bruto, liquido, extra50, extra100, noturnas, faltas };
  }, [rows]);

  const mesLabel = useMemo(() => {
    if (!startDate) return "";
    const d = new Date(startDate + "T12:00:00");
    return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  }, [startDate]);

  const handleDownloadPDF = async () => {
    setDownloading(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const element = document.getElementById("ficha-ponto");
      if (!element) return;
      await html2pdf().set({
        margin: [5, 5, 5, 5],
        filename: `ficha-ponto-${motoristaNome.replace(/\s+/g, "_")}-${startDate}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
      } as any).from(element).save();
    } catch (err) {
      console.error("Erro ao gerar PDF:", err);
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Carregando relatório...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black p-4 print:p-1" id="ficha-ponto">
      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          #ficha-ponto { padding: 2mm !important; }
        }
        @page { size: A4 landscape; margin: 5mm; }
        #ficha-ponto table { border-collapse: collapse; width: 100%; }
        #ficha-ponto th, #ficha-ponto td { white-space: nowrap; }
      `}</style>

      {/* Action buttons */}
      <div className="no-print fixed top-4 right-4 z-50 flex gap-2">
        <button
          onClick={handleDownloadPDF}
          disabled={downloading}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium shadow disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {downloading ? "Gerando..." : "Baixar PDF"}
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium shadow"
        >
          <Printer className="h-4 w-4" />
          Imprimir
        </button>
      </div>

      {/* Header */}
      <div className="text-center mb-3 border-b-2 border-black pb-2">
        <h1 className="text-base font-bold uppercase">Ficha de Ponto Simplificada</h1>
        <p className="text-xs mt-0.5">{COMPANY_NAME}</p>
      </div>

      {/* Driver Info */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
        <div><strong>Motorista:</strong> {motoristaNome}</div>
        <div><strong>CPF:</strong> {motoristaCpf || "Não informado"}</div>
        <div><strong>Período:</strong> {mesLabel}</div>
      </div>

      {/* Table */}
      <table style={{ fontSize: "7.5pt", lineHeight: "1.1" }}>
        <thead>
          <tr className="bg-gray-200">
            <th className="border border-gray-400 px-1 py-0.5 text-left">Data</th>
            <th className="border border-gray-400 px-1 py-0.5 text-left">Dia</th>
            <th className="border border-gray-400 px-1 py-0.5 text-center">Início</th>
            <th className="border border-gray-400 px-1 py-0.5 text-center">Fim</th>
            <th className="border border-gray-400 px-1 py-0.5 text-center" colSpan={2}>Refeição</th>
            <th className="border border-gray-400 px-1 py-0.5 text-center" colSpan={2}>Repouso</th>
            <th className="border border-gray-400 px-1 py-0.5 text-center" colSpan={2}>Complemento</th>
            <th className="border border-gray-400 px-1 py-0.5 text-center">Jornada</th>
            <th className="border border-gray-400 px-1 py-0.5 text-center">Faltas</th>
            <th className="border border-gray-400 px-1 py-0.5 text-center">H.Extra</th>
            <th className="border border-gray-400 px-1 py-0.5 text-center">H.Noturna</th>
            <th className="border border-gray-400 px-1 py-0.5 text-center">Bruto</th>
            <th className="border border-gray-400 px-1 py-0.5 text-center">Líquido</th>
          </tr>
          <tr className="bg-gray-100" style={{ fontSize: "6.5pt" }}>
            <th className="border border-gray-400 px-1 py-0"></th>
            <th className="border border-gray-400 px-1 py-0"></th>
            <th className="border border-gray-400 px-1 py-0 text-center">Jornada</th>
            <th className="border border-gray-400 px-1 py-0 text-center">Jornada</th>
            <th className="border border-gray-400 px-1 py-0 text-center">Início</th>
            <th className="border border-gray-400 px-1 py-0 text-center">Fim</th>
            <th className="border border-gray-400 px-1 py-0 text-center">Início</th>
            <th className="border border-gray-400 px-1 py-0 text-center">Fim</th>
            <th className="border border-gray-400 px-1 py-0 text-center">Início</th>
            <th className="border border-gray-400 px-1 py-0 text-center">Fim</th>
            <th className="border border-gray-400 px-1 py-0 text-center">08:00</th>
            <th className="border border-gray-400 px-1 py-0"></th>
            <th className="border border-gray-400 px-1 py-0"></th>
            <th className="border border-gray-400 px-1 py-0"></th>
            <th className="border border-gray-400 px-1 py-0"></th>
            <th className="border border-gray-400 px-1 py-0"></th>
          </tr>
        </thead>
        <tbody>
          {tableRows.map((row, idx) => {
            if (row.type === "subtotal") {
              return (
                <tr key={`week-${row.weekNum}`} className="bg-yellow-100 font-bold" style={{ fontSize: "7pt" }}>
                  <td className="border border-gray-400 px-1 py-0.5" colSpan={10} style={{ textAlign: "right" }}>
                    TT HS Semana {row.weekNum}
                  </td>
                  <td className="border border-gray-400 px-1 py-0.5 text-center font-mono">—</td>
                  <td className="border border-gray-400 px-1 py-0.5 text-center font-mono text-amber-700">
                    {row.faltas > 0 ? formatMinutesHHMM(row.faltas) : "—"}
                  </td>
                  <td className="border border-gray-400 px-1 py-0.5 text-center font-mono text-red-600">
                    {(row.extra50 + row.extra100) > 0 ? formatMinutesHHMM(row.extra50 + row.extra100) : "—"}
                  </td>
                  <td className="border border-gray-400 px-1 py-0.5 text-center font-mono text-blue-700">
                    {row.noturnas > 0 ? formatMinutesHHMM(row.noturnas) : "—"}
                  </td>
                  <td className="border border-gray-400 px-1 py-0.5 text-center font-mono">
                    {row.bruto > 0 ? formatMinutesHHMM(row.bruto) : "—"}
                  </td>
                  <td className="border border-gray-400 px-1 py-0.5 text-center font-mono">
                    {row.liquido > 0 ? formatMinutesHHMM(row.liquido) : "—"}
                  </td>
                </tr>
              );
            }

            const r = row;
            const bgClass = r.dayMark === "folga" ? "bg-green-50" : r.dayMark === "atestado" ? "bg-blue-50" : r.dayMark === "afastamento" ? "bg-purple-50" : r.dayMark === "falta" ? "bg-orange-50" : r.isDomingoFeriado ? "bg-red-50" : "";
            const dayMarkLabel = r.dayMark ? ({ folga: "🏖️ Folga", falta: "❌ Falta", atestado: "🏥 Atestado", afastamento: "🚫 Afastamento" }[r.dayMark] || "") : "";
            return (
              <tr key={r.date} className={bgClass}>
                <td className="border border-gray-300 px-1 py-0.5">{formatDateBR(r.date)}</td>
                <td className="border border-gray-300 px-1 py-0.5">
                  {r.diaSemana}
                  {r.isDomingoFeriado && " 🔴"}
                  {dayMarkLabel && <span className="ml-1 text-[10px] font-semibold">{dayMarkLabel}</span>}
                </td>
                <td className="border border-gray-300 px-1 py-0.5 text-center">{r.inicioJornada}</td>
                <td className="border border-gray-300 px-1 py-0.5 text-center">{r.fimJornada}</td>
                <td className="border border-gray-300 px-1 py-0.5 text-center">{r.refeicaoInicio}</td>
                <td className="border border-gray-300 px-1 py-0.5 text-center">{r.refeicaoFim}</td>
                <td className="border border-gray-300 px-1 py-0.5 text-center">{r.repousoInicio}</td>
                <td className="border border-gray-300 px-1 py-0.5 text-center">{r.repousoFim}</td>
                <td className="border border-gray-300 px-1 py-0.5 text-center">{r.complementoInicio}</td>
                <td className="border border-gray-300 px-1 py-0.5 text-center">{r.complementoFim}</td>
                <td className="border border-gray-300 px-1 py-0.5 text-center font-mono">
                  {r.hasJourney ? "08:00" : "—"}
                </td>
                <td className="border border-gray-300 px-1 py-0.5 text-center font-mono font-bold text-amber-700">
                  {r.horasFalta > 0 ? formatMinutesHHMM(r.horasFalta) : "—"}
                </td>
                <td className="border border-gray-300 px-1 py-0.5 text-center font-mono font-bold text-red-600">
                  {r.horasExtras > 0 ? formatMinutesHHMM(r.horasExtras) : "—"}
                </td>
                <td className="border border-gray-300 px-1 py-0.5 text-center font-mono text-blue-700">
                  {r.horasNoturnas > 0 ? formatMinutesHHMM(r.horasNoturnas) : "—"}
                </td>
                <td className="border border-gray-300 px-1 py-0.5 text-center font-mono">
                  {r.totalBruto > 0 ? formatMinutesHHMM(r.totalBruto) : "—"}
                </td>
                <td className="border border-gray-300 px-1 py-0.5 text-center font-mono">
                  {r.totalLiquido > 0 ? formatMinutesHHMM(r.totalLiquido) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Totals */}
      <div className="mt-3 border-2 border-black rounded p-2">
        <h3 className="font-bold text-xs mb-2 uppercase">Totalizadores do Período</h3>
        <div className="grid grid-cols-6 gap-2 text-xs">
          <div className="text-center border rounded p-1.5">
            <div className="text-[9px] text-gray-500">Total Bruto</div>
            <div className="font-bold font-mono text-sm">{formatMinutesHHMM(totals.bruto)}</div>
          </div>
          <div className="text-center border rounded p-1.5">
            <div className="text-[9px] text-gray-500">Total Líquido</div>
            <div className="font-bold font-mono text-sm">{formatMinutesHHMM(totals.liquido)}</div>
          </div>
          <div className="text-center border rounded p-1.5 bg-amber-50">
            <div className="text-[9px] text-gray-500">Horas Falta</div>
            <div className="font-bold font-mono text-sm text-amber-700">{formatMinutesHHMM(totals.faltas)}</div>
            <div className="text-[8px] text-gray-400">Jornada &lt; 08:00</div>
          </div>
          <div className="text-center border rounded p-1.5 bg-orange-50">
            <div className="text-[9px] text-gray-500">Hora Extra 50%</div>
            <div className="font-bold font-mono text-sm text-orange-600">{formatMinutesHHMM(totals.extra50)}</div>
            <div className="text-[8px] text-gray-400">Dias úteis</div>
          </div>
          <div className="text-center border rounded p-1.5 bg-red-50">
            <div className="text-[9px] text-gray-500">Hora Extra 100%</div>
            <div className="font-bold font-mono text-sm text-red-600">{formatMinutesHHMM(totals.extra100)}</div>
            <div className="text-[8px] text-gray-400">Domingos e Feriados</div>
          </div>
          <div className="text-center border rounded p-1.5 bg-blue-50">
            <div className="text-[9px] text-gray-500">Horas Noturnas</div>
            <div className="font-bold font-mono text-sm text-blue-700">{formatMinutesHHMM(totals.noturnas)}</div>
            <div className="text-[8px] text-gray-400">22:00 às 06:00</div>
          </div>
        </div>
      </div>

      {/* Signatures */}
      <div className="mt-10 grid grid-cols-2 gap-16 px-8">
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

      <div className="mt-4 text-center text-[8px] text-gray-400 no-print">
        Gerado em {new Date().toLocaleString("pt-BR")}
      </div>
    </div>
  );
}
