import * as XLSX from "xlsx";
import { MacroNumber } from "@/types/journey";

interface ParsedRow {
  vehicleName: string;
  macroNumber: MacroNumber;
  createdAt: Date;
}

const VALID_MACROS = new Set([1, 2, 3, 4, 5, 6, 9, 10]);

function parseDate(val: any): Date | null {
  if (val instanceof Date) return val;
  if (typeof val === "number") {
    // Excel serial date
    const date = XLSX.SSF.parse_date_code(val);
    if (date) return new Date(date.y, date.m - 1, date.d, date.H, date.M, date.S);
  }
  if (typeof val === "string") {
    // Try DD/MM/YYYY HH:mm
    const match = val.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
    if (match) {
      return new Date(
        parseInt(match[3]),
        parseInt(match[2]) - 1,
        parseInt(match[1]),
        parseInt(match[4]),
        parseInt(match[5])
      );
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

export function parseXlsx(buffer: ArrayBuffer): { rows: ParsedRow[]; errors: string[] } {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

  const rows: ParsedRow[] = [];
  const errors: string[] = [];

  // Skip header row if it looks like headers
  let startRow = 0;
  if (data.length > 0) {
    const first = String(data[0][0] || "").toLowerCase();
    if (first.includes("nome") || first.includes("veículo") || first.includes("veiculo") || first.includes("vehicle")) {
      startRow = 1;
    }
  }

  for (let i = startRow; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length < 3) continue;

    const vehicleName = String(row[0] || "").trim();
    const macroNum = parseInt(String(row[1]));
    const createdAt = parseDate(row[2]);

    if (!vehicleName) {
      errors.push(`Linha ${i + 1}: Nome do veículo vazio`);
      continue;
    }
    if (!VALID_MACROS.has(macroNum)) {
      errors.push(`Linha ${i + 1}: Macro inválida (${row[1]})`);
      continue;
    }
    if (!createdAt) {
      errors.push(`Linha ${i + 1}: Data inválida (${row[2]})`);
      continue;
    }

    rows.push({ vehicleName, macroNumber: macroNum as MacroNumber, createdAt });
  }

  // Sort chronologically
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return { rows, errors };
}
