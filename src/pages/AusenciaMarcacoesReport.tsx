import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { MacroNumber } from "@/types/journey";
import { buildJourneys, toDateKey } from "@/lib/journeyEngine";
import { Printer, Download, AlertCircle } from "lucide-react";

const COMPANY_NAME = "Cocal Transportes";

function formatDateBR(dateStr: string): string {
  if (!dateStr) return "—";
  const [y, mo, d] = dateStr.split("-");
  return `${d}/${mo}/${y}`;
}

function formatTime(d: Date | null): string {
  if (!d) return "___:___";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

interface MissingRow {
  date: string;
  m1: Date | null;
  m2: Date | null;
  m3: Date | null;
  m4: Date | null;
  missingLabels: string[];
  vehicle: string;
}

export default function AusenciaMarcacoesReport() {
  const [searchParams] = useSearchParams();
  const motoristaNome = searchParams.get("motorista_nome") || "";
  const motoristaCpf = searchParams.get("motorista_cpf") || "";
  const startDate = searchParams.get("start") || "";
  const endDate = searchParams.get("end") || "";
  const vehicleCodesStr = searchParams.get("vehicle_codes") || "";
  const driverSenha = searchParams.get("senha") || "";

  const [rows, setRows] = useState<MissingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    loadData();
  }, [startDate, endDate]);

  const loadData = async () => {
    setLoading(true);
    try {
      const vehicleCodes = vehicleCodesStr.split(",").filter(Boolean).map(Number);
      if (vehicleCodes.length === 0 && !driverSenha) {
        setRows([]);
        return;
      }

      // Fetch events
      let allEvents: any[] = [];
      const startISO = new Date(startDate + "T00:00:00").toISOString();
      const endISO = new Date(endDate + "T23:59:59").toISOString();

      let query = supabase
        .from("autotrac_eventos")
        .select("*")
        .gte("message_time", startISO)
        .lte("message_time", endISO)
        .order("message_time", { ascending: true });

      if (vehicleCodes.length > 0) {
        query = query.in("vehicle_code", vehicleCodes);
      }

      const { data: eventsData } = await query;
      allEvents = eventsData || [];

      // Filter by driver password if applicable
      if (driverSenha) {
        allEvents = allEvents.filter((e: any) => {
          const msgText = e.raw_data?.MessageText ? String(e.raw_data.MessageText) : "";
          return msgText.includes(`_${driverSenha}`);
        });
      }

      // Map to Engine format
      const mapped = allEvents.map((e: any) => ({
        id: e.id,
        vehicleId: String(e.vehicle_code),
        macroNumber: e.macro_number as MacroNumber,
        createdAt: new Date(e.message_time),
        dataJornada: toDateKey(new Date(e.message_time)),
      }));

      const journeys = buildJourneys(mapped);

      // Fetch marks (folga, atestado, etc) to exclude
      const { data: marksData } = await (supabase as any)
        .from("macro_overrides")
        .select("*")
        .in("action", ["folga", "falta", "atestado", "afastamento"])
        .gte("event_time", startISO)
        .lte("event_time", endISO);

      const dayMarks = new Set<string>();
      if (marksData) {
        marksData.forEach((m: any) => {
          dayMarks.add(toDateKey(new Date(m.event_time)));
        });
      }

      // Generate all days in period
      const missingRows: MissingRow[] = [];
      const cur = new Date(startDate + "T12:00:00");
      const endD = new Date(endDate + "T12:00:00");

      while (cur <= endD) {
        const dk = toDateKey(cur);
        
        // Skip if there's a day mark (folga, etc)
        if (!dayMarks.has(dk)) {
          const dayJourneys = journeys.filter(j => j.date === dk);
          
          if (dayJourneys.length > 0) {
            const j = dayJourneys[dayJourneys.length - 1]; // Use last journey of the day
            const m1 = j.macros.find(m => m.macroNumber === 1)?.createdAt || null;
            const m2 = j.macros.find(m => m.macroNumber === 2)?.createdAt || null;
            const m3 = j.macros.find(m => m.macroNumber === 3)?.createdAt || null;
            const m4 = j.macros.find(m => m.macroNumber === 4)?.createdAt || null;

            const missing: string[] = [];
            if (!m1) missing.push("Início de Jornada");
            if (!m3) missing.push("Início de Refeição");
            if (!m4) missing.push("Fim de Refeição");
            if (!m2) missing.push("Fim de Jornada");

            if (missing.length > 0) {
              missingRows.push({
                date: dk,
                m1, m2, m3, m4,
                missingLabels: missing,
                vehicle: j.vehicleId
              });
            }
          }
        }
        cur.setDate(cur.getDate() + 1);
      }

      setRows(missingRows);
    } catch (err) {
      console.error("Erro ao carregar ausências:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPDF = async () => {
    setDownloading(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const element = document.getElementById("report-content");
      if (!element) return;
      await html2pdf().set({
        margin: [10, 10, 10, 10],
        filename: `ausencia-marcacoes-${motoristaNome.replace(/\s+/g, "_")}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      }).from(element).save();
    } catch (err) {
      console.error(err);
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500 italic">Analisando jornadas e buscando ausências...</div>;

  return (
    <div className="min-h-screen bg-white text-black p-8 font-sans">
      <style>{`
        @media print {
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print fixed top-4 right-4 flex gap-2">
        <button onClick={handleDownloadPDF} disabled={downloading} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded shadow hover:bg-green-700 disabled:opacity-50 text-sm">
          <Download className="h-4 w-4" /> {downloading ? "Gerando..." : "PDF"}
        </button>
        <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded shadow hover:bg-blue-700 text-sm">
          <Printer className="h-4 w-4" /> Imprimir
        </button>
      </div>

      <div id="report-content" className="max-w-4xl mx-auto">
        <div className="flex justify-between items-end border-b-2 border-gray-800 pb-4 mb-6">
          <div className="flex items-center gap-4">
            <img src="/logo-jornada.png" alt="Logo" style={{ height: "50px", objectFit: "contain" }} />
            <div>
              <h1 className="text-xl font-bold uppercase">Relatório de Ausência de Marcações</h1>
              <p className="text-sm text-gray-600">Conformidade de Jornada</p>
            </div>
          </div>
          <div className="text-right text-sm">
            <p><strong>Motorista:</strong> {motoristaNome}</p>
            <p><strong>CPF:</strong> {motoristaCpf}</p>
            <p><strong>Período:</strong> {formatDateBR(startDate)} a {formatDateBR(endDate)}</p>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="bg-green-50 border border-green-200 p-6 rounded-lg text-center">
            <p className="text-green-700 font-medium">Parabéns! Nenhuma ausência de marcação obrigatória foi detectada para o período selecionado.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 text-xs">
              <AlertCircle className="h-4 w-4" />
              <span>Foram detectadas lacunas nas marcações obrigatórias de jornada (Início/Fim e Refeição). Preencha o campo "Justificativa" para cada item faltante.</span>
            </div>

            <table className="w-full border-collapse mb-8 text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-400 p-2 text-left">Data</th>
                  <th className="border border-gray-400 p-2 text-center">Início Jorn.</th>
                  <th className="border border-gray-400 p-2 text-center">Início Ref.</th>
                  <th className="border border-gray-400 p-2 text-center">Fim Ref.</th>
                  <th className="border border-gray-400 p-2 text-center">Fim Jorn.</th>
                  <th className="border border-gray-400 p-2 text-left">Itens Faltantes</th>
                  <th className="border border-gray-400 p-2 text-left no-print">Justificativa</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.date}>
                    <td className="border border-gray-400 p-2 font-medium">{formatDateBR(row.date)}</td>
                    <td className={`border border-gray-400 p-2 text-center ${!row.m1 ? "text-red-600 font-bold" : ""}`}>{formatTime(row.m1)}</td>
                    <td className={`border border-gray-400 p-2 text-center ${!row.m3 ? "text-red-600 font-bold" : ""}`}>{formatTime(row.m3)}</td>
                    <td className={`border border-gray-400 p-2 text-center ${!row.m4 ? "text-red-600 font-bold" : ""}`}>{formatTime(row.m4)}</td>
                    <td className={`border border-gray-400 p-2 text-center ${!row.m2 ? "text-red-600 font-bold" : ""}`}>{formatTime(row.m2)}</td>
                    <td className="border border-gray-400 p-2 text-xs">{row.missingLabels.join(", ")}</td>
                    <td className="border border-gray-400 p-2 no-print">
                      <div className="h-8 border-b border-gray-300 w-full"></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="mt-16 grid grid-cols-2 gap-20 px-10">
          <div className="text-center">
            <div className="border-t border-black pt-2">
              <p className="font-bold">{motoristaNome}</p>
              <p className="text-xs text-gray-600 font-medium">Assinatura do Motorista</p>
            </div>
          </div>
          <div className="text-center">
            <div className="border-t border-black pt-2">
              <p className="font-bold">{COMPANY_NAME}</p>
              <p className="text-xs text-gray-600 font-medium">Assinatura da Empresa</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
