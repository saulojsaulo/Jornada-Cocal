import { useMemo, useState } from "react";
import { useJourneyStore } from "@/context/JourneyContext";
import { calculateJourney, formatMinutes } from "@/lib/journeyEngine";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Clock, TrendingUp, Activity, Users } from "lucide-react";

type PeriodoType = "hoje" | "ontem" | "mes_atual" | "mes_anterior" | "personalizado";

// All colors pulled from CSS custom properties defined in index.css
const CHART_COLORS = [
  "hsl(220, 70%, 45%)",   // --chart-1 (blue)
  "hsl(142, 55%, 49%)",   // --chart-2 (primary green)
  "hsl(38, 70%, 60%)",    // --chart-3 (amber)
  "hsl(300, 40%, 60%)",   // --chart-4 (purple)
  "hsl(0, 72%, 51%)",     // --chart-5 (red)
  "hsl(180, 55%, 45%)",
  "hsl(260, 60%, 55%)",
  "hsl(25, 80%, 55%)",
  "hsl(200, 65%, 45%)",
  "hsl(340, 60%, 50%)",
];

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getDateRange(periodo: PeriodoType, customStart: string, customEnd: string) {
  const now = new Date();
  if (periodo === "hoje") return { start: fmt(now), end: fmt(now) };
  if (periodo === "ontem") { const y = new Date(now); y.setDate(y.getDate() - 1); return { start: fmt(y), end: fmt(y) }; }
  if (periodo === "mes_atual") return { start: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), end: fmt(now) };
  if (periodo === "mes_anterior") return { start: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: fmt(new Date(now.getFullYear(), now.getMonth(), 0)) };
  return { start: customStart, end: customEnd };
}

// ──────────────────────────────────────────────────────────────────────────────
// KPI Card — uses system card background and a left accent border
// ──────────────────────────────────────────────────────────────────────────────
function KPICard({
  icon: Icon, label, value, sub, accent,
}: {
  icon: React.ElementType; label: string; value: string; sub?: string;
  accent: "primary" | "warning" | "danger" | "info";
}) {
  const accentMap = {
    primary: "border-l-[hsl(var(--primary))] text-[hsl(var(--primary))]",
    warning:  "border-l-[hsl(var(--alert-warning))] text-[hsl(var(--alert-warning))]",
    danger:   "border-l-[hsl(var(--destructive))] text-[hsl(var(--destructive))]",
    info:     "border-l-[hsl(var(--chart-1))] text-[hsl(var(--chart-1))]",
  };
  return (
    <div className={`rounded-lg border bg-card p-4 border-l-4 ${accentMap[accent]} shadow-sm flex gap-3 items-start`}>
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold tabular-nums text-foreground leading-tight mt-0.5">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Period pill button
// ──────────────────────────────────────────────────────────────────────────────
function PeriodBtn({ id, label, active, onClick }: { id: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all border ${
        active
          ? "bg-primary text-primary-foreground border-primary shadow-sm"
          : "bg-card text-muted-foreground border-border hover:border-primary/60 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Chart tooltip shared style
// ──────────────────────────────────────────────────────────────────────────────
const tooltipStyle = {
  contentStyle: {
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: 11,
    color: "hsl(var(--foreground))",
  },
  cursor: { fill: "hsl(var(--muted))" },
};

// ──────────────────────────────────────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────────────────────────────────────
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

  // Per-driver aggregation
  const driverData = useMemo(() => {
    const map = new Map<string, { name: string; gestor: string; totalNet: number; totalOvertime: number; count: number; overtimeCount: number }>();
    for (const j of filteredJourneys) {
      const vehicle = vehicleById.get(j.vehicleId);
      const driverName = j.driverName || vehicle?.driverName || j.vehicleId;
      const key = driverName;
      if (!map.has(key)) map.set(key, { name: driverName, gestor: vehicle?.gestorName || "Sem Gestor", totalNet: 0, totalOvertime: 0, count: 0, overtimeCount: 0 });
      const e = map.get(key)!;
      const calc = calculateJourney(j);
      e.totalNet += calc.netMinutes;
      e.totalOvertime += calc.overtimeMinutes;
      e.count++;
      if (calc.overtimeMinutes > 0) e.overtimeCount++;
    }
    return Array.from(map.values())
      .filter(d => d.totalOvertime > 0)
      .sort((a, b) => b.totalOvertime - a.totalOvertime)
      .map(d => ({ ...d, horasExtrasH: +(d.totalOvertime / 60).toFixed(1), horasTotaisH: +(d.totalNet / 60).toFixed(1) }));
  }, [filteredJourneys, vehicleById]);

  // Per-gestor aggregation
  const gestorData = useMemo(() => {
    const map = new Map<string, { name: string; totalOvertime: number; drivers: Set<string> }>();
    for (const j of filteredJourneys) {
      const vehicle = vehicleById.get(j.vehicleId);
      const gestor = vehicle?.gestorName || "Sem Gestor";
      const calc = calculateJourney(j);
      if (!map.has(gestor)) map.set(gestor, { name: gestor, totalOvertime: 0, drivers: new Set() });
      const e = map.get(gestor)!;
      e.totalOvertime += calc.overtimeMinutes;
      e.drivers.add(j.driverName || vehicle?.driverName || j.vehicleId);
    }
    return Array.from(map.values())
      .filter(d => d.totalOvertime > 0)
      .sort((a, b) => b.totalOvertime - a.totalOvertime)
      .map(d => ({ name: d.name, horasExtras: +(d.totalOvertime / 60).toFixed(1), motoristas: d.drivers.size }));
  }, [filteredJourneys, vehicleById]);

  // KPIs
  const totalOvertimeMins = driverData.reduce((s, d) => s + d.totalOvertime, 0);
  const driversWithOvertime = driverData.length;
  const totalJourneys = filteredJourneys.length;
  const overtimeJourneys = driverData.reduce((s, d) => s + d.overtimeCount, 0);
  const pctOvertime = totalJourneys > 0 ? Math.round((overtimeJourneys / totalJourneys) * 100) : 0;

  const periodos: { id: PeriodoType; label: string }[] = [
    { id: "hoje", label: "Hoje" },
    { id: "ontem", label: "Ontem" },
    { id: "mes_atual", label: "Mês Atual" },
    { id: "mes_anterior", label: "Mês Anterior" },
    { id: "personalizado", label: "Personalizado" },
  ];

  const hasData = driverData.length > 0;

  return (
    <div className="space-y-5">
      {/* ── Period Selector ─────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {periodos.map(p => (
          <PeriodBtn key={p.id} id={p.id} label={p.label} active={periodo === p.id} onClick={() => setPeriodo(p.id)} />
        ))}
        {periodo === "personalizado" && (
          <div className="flex items-center gap-1.5 ml-2 flex-wrap">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="border border-border rounded-md px-2.5 py-1.5 text-xs bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
            <span className="text-xs text-muted-foreground">—</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="border border-border rounded-md px-2.5 py-1.5 text-xs bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
        )}
      </div>

      {/* ── KPI Cards ─────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard icon={Clock}       label="Total H. Extras"      value={formatMinutes(totalOvertimeMins)} accent="danger" />
        <KPICard icon={Users}       label="Motoristas c/ Extras" value={String(driversWithOvertime)} sub="no período" accent="warning" />
        <KPICard icon={Activity}    label="Jornadas Analisadas"  value={String(totalJourneys)} sub="concluídas" accent="info" />
        <KPICard icon={TrendingUp}  label="% com Excesso"        value={`${pctOvertime}%`} sub="das jornadas" accent="primary" />
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center py-20 rounded-xl border border-dashed bg-card text-muted-foreground gap-2">
          <TrendingUp className="h-8 w-8 opacity-20" />
          <p className="text-sm">Nenhuma hora extra encontrada neste período.</p>
        </div>
      ) : (
        <>
          {/* ── Driver Bar Chart ───────────────── */}
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b bg-muted/30 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Ranking por Motorista</h3>
              <span className="ml-auto text-[11px] text-muted-foreground">Top {Math.min(15, driverData.length)}</span>
            </div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={Math.max(260, driverData.slice(0, 15).length * 36)}>
                <BarChart data={driverData.slice(0, 15)} layout="vertical" margin={{ left: 140, right: 30, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `${v}h`} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--foreground))" }} width={130} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} formatter={(v: number, name: string) => [`${v}h`, name === "horasExtrasH" ? "Horas Extras" : "Horas Totais"]} />
                  <Bar dataKey="horasTotaisH" name="horasTotaisH" fill="hsl(var(--muted))" radius={[0, 4, 4, 0]} barSize={10} />
                  <Bar dataKey="horasExtrasH" name="horasExtrasH" fill="hsl(var(--destructive))" radius={[0, 4, 4, 0]} barSize={10} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-2 justify-end">
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="inline-block w-3 h-2.5 rounded-sm bg-muted border" />Horas Totais
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-destructive">
                  <span className="inline-block w-3 h-2.5 rounded-sm bg-destructive" />Horas Extras
                </span>
              </div>
            </div>
          </div>

          {/* ── Gestor Section ──────────────────── */}
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b bg-muted/30 flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Horas Extras por Gestor</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-border">
              {/* Pie */}
              <div className="p-4 flex items-center justify-center">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={gestorData} dataKey="horasExtras" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={45} paddingAngle={2}>
                      {gestorData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={0} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => [`${v}h`, "H. Extras"]} contentStyle={tooltipStyle.contentStyle} />
                    <Legend formatter={(v) => <span style={{ fontSize: 11 }}>{v}</span>} wrapperStyle={{ paddingTop: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* Gestor table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm h-full">
                  <thead className="border-b bg-muted/20">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Gestor</th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">H. Extras</th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Motoristas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {gestorData.map((g, i) => (
                      <tr key={g.name} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 flex items-center gap-2 text-sm font-medium">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          {g.name}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-destructive">{g.horasExtras}h</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">{g.motoristas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── Detail Table ────────────────────── */}
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b bg-muted/30 flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Detalhamento por Motorista</h3>
              <span className="ml-auto text-[11px] text-muted-foreground">{driverData.length} motorista(s)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/20">
                  <tr>
                    {["#", "Motorista", "Gestor", "H. Totais", "H. Extras", "Jornadas", "C/ Extras", "% Excesso", "Média Extra"].map((h, i) => (
                      <th key={h} className={`px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider ${i > 2 ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {driverData.map((d, i) => (
                    <tr key={d.name} className="hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2.5 font-medium max-w-[160px] truncate" title={d.name}>{d.name}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{d.gestor}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{d.horasTotaisH}h</td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-destructive">{d.horasExtrasH}h</td>
                      <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">{d.count}</td>
                      <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">{d.overtimeCount}</td>
                      <td className="px-3 py-2.5 text-right text-xs">{d.count > 0 ? Math.round((d.overtimeCount / d.count) * 100) : 0}%</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">{formatMinutes(d.count > 0 ? Math.round(d.totalOvertime / d.count) : 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
