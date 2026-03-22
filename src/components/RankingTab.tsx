import { useMemo, useState } from "react";
import { useJourneyStore } from "@/context/JourneyContext";
import { calculateJourney, formatMinutes } from "@/lib/journeyEngine";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

export default function RankingTab() {
  const { vehicles, getVehicleJourneys } = useJourneyStore();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const data = useMemo(() => {
    return vehicles.map((v) => {
      const journeys = getVehicleJourneys(v.id);
      let totalNet = 0;
      let totalOvertime = 0;
      let journeyCount = 0;
      let overtimeJourneys = 0;

      for (const j of journeys) {
        if (dateFrom && j.date < dateFrom) continue;
        if (dateTo && j.date > dateTo) continue;

        const calc = calculateJourney(j);
        if (!j.endTime) continue; // Only count completed journeys

        totalNet += calc.netMinutes;
        totalOvertime += calc.overtimeMinutes;
        journeyCount++;
        if (calc.overtimeMinutes > 0) overtimeJourneys++;
      }

      return {
        name: v.name,
        horasTotais: Math.round(totalNet / 60 * 10) / 10,
        horasExtras: Math.round(totalOvertime / 60 * 10) / 10,
        jornadas: journeyCount,
        jornadasExtras: overtimeJourneys,
        mediaExtras: journeyCount > 0 ? Math.round((totalOvertime / journeyCount) * 10) / 10 : 0,
        pctExcesso: journeyCount > 0 ? Math.round((overtimeJourneys / journeyCount) * 100) : 0,
      };
    }).sort((a, b) => b.horasExtras - a.horasExtras);
  }, [vehicles, getVehicleJourneys, dateFrom, dateTo]);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex gap-4 items-end flex-wrap">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Data Início</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border rounded-md px-3 py-1.5 text-sm bg-card" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Data Fim</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border rounded-md px-3 py-1.5 text-sm bg-card" />
        </div>
      </div>

      {data.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">Nenhum dado disponível para o período selecionado.</div>
      ) : (
        <>
          {/* Chart */}
          <div className="bg-card rounded-lg border p-4">
            <h3 className="text-sm font-semibold mb-4">Ranking de Horas Extras por Veículo</h3>
            <ResponsiveContainer width="100%" height={Math.max(300, data.length * 40)}>
              <BarChart data={data} layout="vertical" margin={{ left: 120 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number, name: string) => [`${value}h`, name === "horasTotais" ? "Horas Totais" : "Horas Extras"]}
                />
                <Legend formatter={(value) => value === "horasTotais" ? "Horas Totais" : "Horas Extras"} />
                <Bar dataKey="horasTotais" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                <Bar dataKey="horasExtras" fill="hsl(var(--destructive))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <div className="bg-card rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Veículo</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Horas Totais</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Horas Extras</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Jornadas</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">C/ Extras</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Média Extra/Dia</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">% Excesso</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.name} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{d.name}</td>
                    <td className="px-3 py-2 text-right font-mono">{d.horasTotais}h</td>
                    <td className="px-3 py-2 text-right font-mono text-destructive font-semibold">{d.horasExtras}h</td>
                    <td className="px-3 py-2 text-right">{d.jornadas}</td>
                    <td className="px-3 py-2 text-right">{d.jornadasExtras}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMinutes(d.mediaExtras)}</td>
                    <td className="px-3 py-2 text-right">{d.pctExcesso}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
