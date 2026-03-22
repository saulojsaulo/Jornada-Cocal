import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseXlsx } from "@/lib/xlsxParser";
import { useJourneyStore } from "@/context/JourneyContext";
import { toast } from "sonner";

export default function XlsxImporter() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const store = useJourneyStore();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const { rows, errors } = parseXlsx(buffer);

      if (errors.length > 0) {
        toast.error(`${errors.length} erro(s) na importação`, {
          description: errors.slice(0, 3).join("\n"),
        });
      }

      if (rows.length > 0) {
        const result = store.addEvents(rows);
        toast.success(`Importação concluída`, {
          description: `${result.added} registro(s) adicionado(s), ${result.skipped} duplicado(s) ignorado(s)`,
        });
      } else {
        toast.warning("Nenhum registro válido encontrado no arquivo");
      }
    } catch (err) {
      toast.error("Erro ao processar arquivo XLSX");
      console.error(err);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFile}
        className="hidden"
      />
      <Button
        onClick={() => fileRef.current?.click()}
        disabled={importing}
        size="sm"
        className="gap-2"
      >
        <Upload className="h-4 w-4" />
        {importing ? "Importando..." : "Importar XLSX"}
      </Button>
    </div>
  );
}
