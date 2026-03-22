import { useMemo, useState } from "react";
import { useJourneyStore } from "@/context/JourneyContext";
import { calculateJourney, calculateInterjornada, buildTimeline, formatMinutes } from "@/lib/journeyEngine";
import { Journey, STATUS_LABELS } from "@/types/journey";
import TimelineBar from "./TimelineBar";

export default function FiltroMotoristaTab() {
  const { vehicles, getVehicleJourneys } = useJourneyStore();
  const [selectedVehicle, setSelectedVehicle] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedJourney, setExpandedJourney] = useState<string | null>(null);
  const [showPrevDay, setShowPrevDay] = useState(true);

  const journeys = useMemo(() => {
    if (!selectedVehicle) return [];
    return getVehicleJourneys(selectedVehicle);
  }, [selectedVehicle, getVehicleJourneys]);

  const filteredJourneys = useMemo(() => {
    return journeys.filter((j) => {
      if (dateFrom && j.date < dateFrom) return false;
      if (dateTo && j.date > dateTo) return false;
      return true;
    });
  }, [journeys, dateFrom, dateTo]);

  const totals = useMemo(() => {
    let totalNet = 0;
    let totalOvertime = 0;
    let exceeded = 0;
    let mealAlerts = 0;
    let interWarnings = 0;
    let interCritical = 0;

    for (let i = 0; i < filteredJourneys.length; i++) {
      const j = filteredJourneys[i];
      const calc = calculateJourney(j);
      totalNet += calc.netMinutes;
      totalOvertime += calc.overtimeMinutes;
      if (calc.netMinutes > 720) exceeded++;
      if (calc.mealAlert) mealAlerts++;

      const prev = i > 0 ? filteredJourneys[i - 1] : null;
      const inter = calculateInterjornada(prev, j);
      if (inter.alert === "warning") interWarnings++;
      if (inter.alert === "critical") interCritical++;
    }

    return {
      totalNet, totalOvertime, exceeded, mealAlerts, interWarnings, interCritical,
      count: filteredJourneys.length,
      avgDaily: filteredJourneys.length > 0 ? totalNet / filteredJourneys.length : 0,
    };
  }, [filteredJourneys]);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex gap-4 items-end flex-wrap">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Veículo / Motorista</label>
          <select
            value={selectedVehicle}
            onChange={(e) => { setSelectedVehicle(e.target.value); setExpandedJourney(null); }}
            className="border rounded-md px-3 py-1.5 text-sm bg-card min-w-[200px]"
          >
            <option value="">Selecione...</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Data Início</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border rounded-md px-3 py-1.5 text-sm bg-card" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Data Fim</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border rounded-md px-3 py-1.5 text-sm bg-card" />
        </div>
      </div>

      {!selectedVehicle ? (
        <div className="text-center py-12 text-muted-foreground">Selecione um veículo para ver o histórico.</div>
      ) : (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { label: "Jornadas", value: String(totals.count) },
              { label: "Horas Totais", value: formatMinutes(totals.totalNet) },
              { label: "Horas Extras", value: formatMinutes(totals.totalOvertime), danger: true },
              { label: "Média/Dia", value: formatMinutes(totals.avgDaily) },
              { label: "Excedidas (>12h)", value: String(totals.exceeded), danger: totals.exceeded > 0 },
              { label: "🍽️ Alertas", value: String(totals.mealAlerts) },
              { label: "💣 Críticos", value: String(totals.interCritical), danger: totals.interCritical > 0 },
            ].map((t) => (
              <div key={t.label} className="bg-card border rounded-lg p-3">
                <span className="text-xs text-muted-foreground">{t.label}</span>
                <p className={`text-lg font-mono font-bold ${t.danger ? "text-destructive" : ""}`}>{t.value}</p>
              </div>
            ))}
          </div>

          {/* Journey list */}
          <div className="bg-card rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Data</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Início</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Fim</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Líquida</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">H. Extras</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">Excedida</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredJourneys.map((j, idx) => {
                  const calc = calculateJourney(j);
                  const isExpanded = expandedJourney === j.id;
                  const timeline = buildTimeline(journeys, j.date, showPrevDay);
                  const exceeded = calc.netMinutes > 720;

                  return (
                    <>
                      <tr
                        key={j.id}
                        className={`border-b cursor-pointer hover:bg-muted/30 ${exceeded ? "bg-destructive/5" : ""}`}
                        onClick={() => setExpandedJourney(isExpanded ? null : j.id)}
                      >
                        <td className="px-3 py-2 font-mono">{j.date}</td>
                        <td className="px-3 py-2 font-mono">{j.startTime.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td>
                        <td className="px-3 py-2 font-mono">
                          {j.endTime ? j.endTime.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "Em andamento"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{formatMinutes(calc.netMinutes)}</td>
                        <td className="px-3 py-2 text-right font-mono text-destructive font-semibold">
                          {calc.overtimeMinutes > 0 ? formatMinutes(calc.overtimeMinutes) : "—"}
                        </td>
                        <td className="px-3 py-2 text-center">{exceeded ? "⚠️" : "✅"}</td>
                        <td className="px-3 py-2 text-center text-xs">{STATUS_LABELS[calc.status]}</td>
                      </tr>
                      {isExpanded && (
                        <tr key={j.id + "-detail"} className="border-b">
                          <td colSpan={7} className="px-4 py-4">
                            <div className="space-y-3">
                              <div className="grid grid-cols-4 gap-3 text-xs">
                                <div className="bg-muted rounded-md p-2">
                                  <span className="text-muted-foreground">Refeição</span>
                                  <p className="font-mono font-semibold">{formatMinutes(calc.mealMinutes)}</p>
                                </div>
                                <div className="bg-muted rounded-md p-2">
                                  <span className="text-muted-foreground">Repouso</span>
                                  <p className="font-mono font-semibold">{formatMinutes(calc.restMinutes)}</p>
                                </div>
                                <div className="bg-muted rounded-md p-2">
                                  <span className="text-muted-foreground">Complemento</span>
                                  <p className="font-mono font-semibold">{formatMinutes(calc.complementMinutes)}</p>
                                </div>
                                <div className="bg-muted rounded-md p-2">
                                  <span className="text-muted-foreground">Bruta</span>
                                  <p className="font-mono font-semibold">{formatMinutes(calc.grossMinutes)}</p>
                                </div>
                              </div>
                              <TimelineBar segments={timeline} showPreviousDay={showPrevDay} onTogglePreviousDay={() => setShowPrevDay(p => !p)} />
                              <div className="flex flex-wrap gap-2">
                                {j.macros.map(m => (
                                  <span key={m.id} className="bg-muted rounded px-2 py-1 font-mono text-xs">
                                    M{m.macroNumber} — {m.createdAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
