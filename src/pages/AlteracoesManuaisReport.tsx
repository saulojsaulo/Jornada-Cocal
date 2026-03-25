import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Printer, Download } from "lucide-react";

const COMPANY_NAME = "Cocal Transportes";

function formatDateBR(dateStr: string): string {
  if (!dateStr) return "—";
  const [y, mo, d] = dateStr.split("-");
  return `${d}/${mo}/${y}`;
}

function formatDateTimeBR(date: Date | string | null): string {
  if (!date) return "—";
  const d = new Date(date);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ACTION_LABELS: Record<string, string> = {
  edit: "Edição",
  delete: "Exclusão",
  insert: "Inserção Manual",
  folga: "Marcação de Folga",
  falta: "Marcação de Falta",
  atestado: "Marcação de Atestado",
  afastamento: "Marcação de Afastamento",
};

interface Alteracao {
  id: string;
  event_time: string;
  action: string;
  reason: string;
  macro_number: number | null;
  created_at: string;
  vehicle_code: number | null;
}

export default function AlteracoesManuaisReport() {
  const [searchParams] = useSearchParams();
  const motoristaId = searchParams.get("motorista_id") || "";
  const motoristaNome = searchParams.get("motorista_nome") || "";
  const motoristaCpf = searchParams.get("motorista_cpf") || "";
  const startDate = searchParams.get("start") || "";
  const endDate = searchParams.get("end") || "";

  const [data, setData] = useState<Alteracao[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    loadData();
  }, [motoristaId, startDate, endDate]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Fetch overrides for this motorista within period
      // We join implicitly by vehicle_code if needed, but macro_overrides has been associated with motoristas
      // if we have the motorista_id or common vehicle usage.
      // For now, we'll fetch all overrides in the period and filter by motorista if the table has it,
      // or by the vehicles that the motorista used.
      
      const vehicleCodes = (searchParams.get("vehicle_codes") || "").split(",").filter(Boolean).map(Number);

      let query = supabase
        .from("macro_overrides")
        .select("*")
        .gte("event_time", `${startDate}T00:00:00`)
        .lte("event_time", `${endDate}T23:59:59`)
        .order("event_time", { ascending: true });

      if (vehicleCodes.length > 0) {
        query = query.in("vehicle_code", vehicleCodes);
      }

      const { data: overrides, error } = await query;
      if (error) throw error;
      setData(overrides || []);
    } catch (err) {
      console.error("Erro ao carregar auditoria:", err);
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
        filename: `alteracoes-manuais-${motoristaNome.replace(/\s+/g, "_")}.pdf`,
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

  if (loading) return <div className="p-8 text-center">Carregando auditoria...</div>;

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
              <h1 className="text-xl font-bold uppercase">Relatório de Alterações Manuais</h1>
              <p className="text-sm text-gray-600">Auditoria de Jornada de Trabalho</p>
            </div>
          </div>
          <div className="text-right text-sm">
            <p><strong>Motorista:</strong> {motoristaNome}</p>
            <p><strong>CPF:</strong> {motoristaCpf}</p>
            <p><strong>Período:</strong> {formatDateBR(startDate)} a {formatDateBR(endDate)}</p>
          </div>
        </div>

        <table className="w-full border-collapse mb-8 text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-400 p-2 text-left">Data/Hora Evento</th>
              <th className="border border-gray-400 p-2 text-left">Tipo de Alteração</th>
              <th className="border border-gray-400 p-2 text-left">Macro</th>
              <th className="border border-gray-400 p-2 text-left">Justificativa / Motivo</th>
              <th className="border border-gray-400 p-2 text-left">Realizado em</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={5} className="border border-gray-400 p-4 text-center text-gray-500 italic">
                  Nenhuma alteração manual registrada para este motorista no período selecionado.
                </td>
              </tr>
            ) : (
              data.map((item) => (
                <tr key={item.id}>
                  <td className="border border-gray-400 p-2 whitespace-nowrap">{formatDateTimeBR(item.event_time)}</td>
                  <td className="border border-gray-400 p-2">{ACTION_LABELS[item.action] || item.action}</td>
                  <td className="border border-gray-400 p-2 text-center">{item.macro_number || "—"}</td>
                  <td className="border border-gray-400 p-2">{item.reason || <span className="text-gray-400 italic">Sem justificativa</span>}</td>
                  <td className="border border-gray-400 p-2 whitespace-nowrap text-xs">{formatDateTimeBR(item.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="mt-12 text-sm leading-relaxed text-justify bg-gray-50 p-4 border rounded italic">
          <p>
            Eu, <strong>{motoristaNome}</strong>, portador do CPF <strong>{motoristaCpf}</strong>, reconheço que as alterações acima listadas referentes à minha jornada de trabalho no período de {formatDateBR(startDate)} a {formatDateBR(endDate)} são verdadeiras e foram realizadas a meu pedido ou por necessidade operacional devidamente justificada, confirmando a veracidade das marcações finais apresentadas nesta data.
          </p>
        </div>

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
