import { useMemo, useState } from "react";
import { useJourneyStore } from "@/context/JourneyContext";
import { calculateJourney, formatMinutes, toDateKey } from "@/lib/journeyEngine";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from "recharts";
import { Clock, TrendingUp, AlertTriangle, Users } from "lucide-react";

type PeriodoType = "hoje" | "ontem" | "mes_atual" | "mes_anterior" | "personalizado";

const COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f59e0b", "#06b6d4",
];

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getDateRange(periodo: PeriodoType, customStart: string, customEnd: string): { start: string; end: string } {
  const now = new Date();
  if (periodo === "hoje") return { start: fmt(now), end: fmt(now) };
  if (periodo === "ontem") {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    return { start: fmt(y), end: fmt(y) };
  }
  if (periodo === "mes_atual") return { start: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), end: fmt(now) };
  if (periodo === "mes_anterior") return { start: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: fmt(new Date(now.getFullYear(), now.getMonth(), 0)) };
  return { start: customStart, end: customEnd };
}

function KPICard({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 flex items-start gap-3 shadow-sm">
      <div className={`rounded-lg p-2 ${color}`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold tabular-nums">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function RankingTab() {
  const { vehicles, getAllJourneys } = useJourneyStore();
  const [periodo, setPeriodo] = useState<PeriodoType>("mes_atual");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const vehicleById = useMemo(() => {
    const m = new Map<string, typeof vehicles[0]>();
    for (const v of vehicles) m.set(v.id, v);
    return m;
  }, [vehicles]);

  const allJourneys = useMemo(() => getAllJourneys(), [getAllJourneys]);

  const { start, end } = getDateRange(periodo, customStart, customEnd);

  const filteredJourneys = useMemo(() => {
    if (!start || !end) return [];
    return allJourneys.filter(j => j.date >= start && j.date <= end && j.endTime);
  }, [allJourneys, start, end]);

  // Per-driver data
  const driverData = useMemo(() => {
    const map = new Map<string, { name: string; gestor: string; totalNet: number; totalOvertime: number; count: number; overtimeCount: number }>();
    for (const j of filteredJourneys) {
      const vehicle = vehicleById.get(j.vehicleId);
      const driverName = j.driverName || vehicle?.driverName || j.vehicleId;
      const gestor = vehicle?.gestorName || "Sem Gestor";
      const key = driverName;
      if (!map.has(key)) map.set(key, { name: driverName, gestor, totalNet: 0, totalOvertime: 0, count: 0, overtimeCount: 0 });
      const entry = map.get(key)!;
      const calc = calculateJourney(j);
      entry.totalNet += calc.netMinutes;
      entry.totalOvertime += calc.overtimeMinutes;
      entry.count++;
      if (calc.overtimeMinutes > 0) entry.overtimeCount++;
    }
    return Array.from(map.values())
      .filter(d => d.totalOvertime > 0)
      .sort((a, b) => b.totalOvertime - a.totalOvertime)
      .map(d => ({
        ...d,
        horasExtrasH: +(d.totalOvertime / 60).toFixed(1),
        horasTotaisH: +(d.totalNet / 60).toFixed(1),
      }));
  }, [filteredJourneys, vehicleById]);

  // Per-gestor data
  const gestorData = useMemo(() => {
    const map = new Map<string, { name: string; totalOvertime: number; drivers: Set<string> }>();
    for (const j of filteredJourneys) {
      const vehicle = vehicleById.get(j.vehicleId);
      const gestor = vehicle?.gestorName || "Sem Gestor";
      const driverName = j.driverName || vehicle?.driverName || j.vehicleId;
      if (!map.has(gestor)) map.set(gestor, { name: gestor, totalOvertime: 0, drivers: new Set() });
      const entry = map.get(gestor)!;
      const calc = calculateJourney(j);
      entry.totalOvertime += calc.overtimeMinutes;
      entry.drivers.add(driverName);
    }
    return Array.from(map.values())
      .filter(d => d.totalOvertime > 0)
      .sort((a, b) => b.totalOvertime - a.totalOvertime)
      .map(d => ({ name: d.name, horasExtras: +(d.totalOvertime / 60).toFixed(1), motoristas: d.drivers.size }));
  }, [filteredJourneys, vehicleById]);

  // KPIs
  const totalOvertimeMins = useMemo(() => driverData.reduce((s, d) => s + d.totalOvertime, 0), [driverData]);
  const driversWithOvertime = driverData.length;
  const totalJourneys = filteredJourneys.length;
  const pctOvertime = totalJourneys > 0 ? Math.round((driverData.reduce((s, d) => s + d.overtimeCount, 0) / totalJourneys) * 100) : 0;

  const periodos: { id: PeriodoType; label: string }[] = [
    { id: "hoje", label: "Hoje" },
    { id: "ontem", label: "Ontem" },
    { id: "mes_atual", label: "Mês Atual" },
    { id: "mes_anterior", label: "Mês Anterior" },
    { id: "personalizado", label: "Personalizado" },
  ];

  return (
    <div className="space-y-6">
      {/* Period filter */}
      <div className="flex flex-wrap items-center gap-2">
        {periodos.map(p => (
          <button
            key={p.id}
            onClick={() => setPeriodo(p.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
              periodo === p.id
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:border-primary hover:text-primary"
            }`}
          >
            {p.label}
          </button>
        ))}
        {periodo === "personalizado" && (
          <div className="flex items-center gap-2 ml-2">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="border rounded-md px-2 py-1 text-xs bg-card" />
            <span className="text-xs text-muted-foreground">até</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="border rounded-md px-2 py-1 text-xs bg-card" />
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard icon={Clock} label="Total Horas Extras" value={formatMinutes(totalOvertimeMins)} color="bg-destructive" />
        <KPICard icon={Users} label="Motoristas c/ Extras" value={String(driversWithOvertime)} sub="no período" color="bg-orange-500" />
        <KPICard icon={TrendingUp} label="Jornadas Analisadas" value={String(totalJourneys)} sub="concluídas" color="bg-blue-500" />
        <KPICard icon={AlertTriangle} label="% com Excesso" value={`${pctOvertime}%`} sub="das jornadas" color="bg-yellow-500" />
      </div>

      {driverData.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground rounded-xl border bg-card">
          <BarChart className="h-10 w-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">Nenhuma hora extra encontrada neste período.</p>
        </div>
      ) : (
        <>
          {/* Ranking por Motorista - Bar Chart */}
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-destructive" />
              Ranking de Horas Extras por Motorista
            </h3>
            <ResponsiveContainer width="100%" height={Math.max(280, driverData.slice(0, 15).length * 38)}>
              <BarChart data={driverData.slice(0, 15)} layout="vertical" margin={{ left: 140, right: 20, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number, name: string) => [`${v}h`, name === "horasExtrasH" ? "H. Extras" : "H. Totais"]}
                />
                <Bar dataKey="horasTotaisH" name="horasTotaisH" fill="hsl(var(--primary))" opacity={0.4} radius={[0, 4, 4, 0]} />
                <Bar dataKey="horasExtrasH" name="horasExtrasH" fill="hsl(var(--destructive))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Seção por Gestor */}
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-500" />
              Horas Extras por Gestor
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              {/* Pie */}
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={gestorData} dataKey="horasExtras" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, horasExtras }) => `${name}: ${horasExtras}h`} labelLine={false}>
                    {gestorData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`${v}h`, "H. Extras"]} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
                  <Legend formatter={(value) => value} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>

              {/* Gestor table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Gestor</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">H. Extras</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Motoristas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gestorData.map((g, i) => (
                      <tr key={g.name} className="border-b hover:bg-muted/30">
                        <td className="px-3 py-2 flex items-center gap-2">
                          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                          {g.name}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-destructive font-semibold">{g.horasExtras}h</td>
                        <td className="px-3 py-2 text-right">{g.motoristas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Full driver table */}
          <div className="rounded-xl border bg-card overflow-x-auto shadow-sm">
            <div className="px-4 py-3 border-b bg-muted/30">
              <h3 className="text-sm font-semibold">Detalhamento por Motorista</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">#</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Motorista</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Gestor</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">H. Totais</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">H. Extras</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Jornadas</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">C/ Extras</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">% Excesso</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Média Extra</th>
                </tr>
              </thead>
              <tbody>
                {driverData.map((d, i) => (
                  <tr key={d.name} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-2 text-muted-foreground text-xs">{i + 1}</td>
                    <td className="px-3 py-2 font-medium max-w-[160px] truncate">{d.name}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{d.gestor}</td>
                    <td className="px-3 py-2 text-right font-mono">{d.horasTotaisH}h</td>
                    <td className="px-3 py-2 text-right font-mono text-destructive font-semibold">{d.horasExtrasH}h</td>
                    <td className="px-3 py-2 text-right">{d.count}</td>
                    <td className="px-3 py-2 text-right">{d.overtimeCount}</td>
                    <td className="px-3 py-2 text-right">{d.count > 0 ? Math.round((d.overtimeCount / d.count) * 100) : 0}%</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMinutes(d.count > 0 ? Math.round(d.totalOvertime / d.count) : 0)}</td>
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
