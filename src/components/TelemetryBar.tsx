import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Activity, Gauge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toDateKey } from "@/lib/journeyEngine";

interface TelemetryBarProps {
  vehicleCode: string;
  date: string;
  macro1Time?: Date | null;
  cursorX?: number | null;
  onCursorChange?: (minute: number | null) => void;
}

type VehicleState = "moving" | "idle" | "stopped";

interface TelemetryPoint {
  timestamp: Date;
  minute: number;
  speed: number;
  ignition: boolean;
  state: VehicleState;
  lat: number | null;
  lng: number | null;
}

function classifyState(speed: number, ignition: boolean, isMovingByCoords: boolean): VehicleState {
  // If speed > 0, vehicle is moving and ignition is necessarily on
  if (speed > 0 || isMovingByCoords) return "moving";
  if (ignition) return "idle";
  return "stopped";
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface TelemetrySegment {
  startMinute: number;
  endMinute: number;
  state: VehicleState;
}

function buildSegments(points: TelemetryPoint[]): TelemetrySegment[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.minute - b.minute);
  const segments: TelemetrySegment[] = [];
  let current: TelemetrySegment = { startMinute: sorted[0].minute, endMinute: sorted[0].minute, state: sorted[0].state };

  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i];
    if (p.state === current.state && p.minute - current.endMinute < 5) {
      current.endMinute = p.minute;
    } else {
      if (current.endMinute === current.startMinute) current.endMinute = current.startMinute + 1;
      segments.push(current);
      current = { startMinute: p.minute, endMinute: p.minute, state: p.state };
    }
  }
  if (current.endMinute === current.startMinute) current.endMinute = current.startMinute + 1;
  segments.push(current);
  return segments;
}

const STATE_LABELS: Record<VehicleState, string> = {
  moving: "Em Movimento",
  idle: "Marcha Lenta",
  stopped: "Parado / Ignição Off",
};

const STATE_DOT_COLORS: Record<VehicleState, string> = {
  moving: "bg-emerald-500",
  idle: "bg-amber-400",
  stopped: "bg-muted-foreground/40",
};

// Speed thresholds for tachograph-style coloring
const SPEED_THRESHOLDS = [
  { max: 0, color: "rgba(156,163,175,0.15)" },     // stopped — near invisible
  { max: 30, color: "rgba(16,185,129,0.7)" },       // green — low speed
  { max: 60, color: "rgba(16,185,129,0.9)" },       // green — cruising
  { max: 80, color: "rgba(245,158,11,0.85)" },      // amber — attention
  { max: 100, color: "rgba(239,68,68,0.75)" },      // red — high speed
  { max: Infinity, color: "rgba(220,38,38,0.95)" },  // deep red — over speed
];

function speedColor(speed: number): string {
  for (const t of SPEED_THRESHOLDS) {
    if (speed <= t.max) return t.color;
  }
  return SPEED_THRESHOLDS[SPEED_THRESHOLDS.length - 1].color;
}

// Segment fill color for the status bar
function segmentFill(state: VehicleState): string {
  if (state === "moving") return "rgba(16,185,129,0.6)";
  if (state === "idle") return "rgba(245,158,11,0.5)";
  return "rgba(156,163,175,0.18)";
}

interface TelemetrySyncRow {
  pontos: unknown;
  distancia_km: number | null;
}

function parseTelemetryPoints(raw: unknown): TelemetryPoint[] {
  const pontos = Array.isArray(raw) ? raw : [];
  const rawPoints: { d: Date; minute: number; speed: number; ignition: boolean; lat: number | null; lng: number | null }[] = [];

  for (const p of pontos) {
    const point = p as { time?: string; speed?: number | string; ignition?: boolean | number; lat?: number | null; lng?: number | null };
    const d = new Date(point.time ?? "");
    if (isNaN(d.getTime())) continue;
    const speed = typeof point.speed === "number" ? point.speed : parseFloat(String(point.speed ?? "0")) || 0;
    // If speed > 0, ignition is necessarily on regardless of raw data
    const ignition = speed > 0 ? true : !!point.ignition;
    rawPoints.push({
      d,
      minute: d.getHours() * 60 + d.getMinutes(),
      speed,
      ignition,
      lat: point.lat ?? null,
      lng: point.lng ?? null,
    });
  }

  rawPoints.sort((a, b) => a.d.getTime() - b.d.getTime());

  return rawPoints.map((p, i) => {
    let isMovingByCoords = false;
    if (p.speed === 0 && p.lat != null && p.lng != null && i > 0) {
      const prev = rawPoints[i - 1];
      if (prev.lat != null && prev.lng != null) {
        isMovingByCoords = haversineKm(prev.lat, prev.lng, p.lat, p.lng) > 0.05;
      }
    }

    return {
      timestamp: p.d,
      minute: p.minute,
      speed: p.speed,
      ignition: p.ignition,
      state: classifyState(p.speed, p.ignition, isMovingByCoords),
      lat: p.lat,
      lng: p.lng,
    };
  });
}

async function fetchTelemetryRow(vehicleCode: string, date: string): Promise<TelemetrySyncRow | null> {
  const numericCode = Number.parseInt(vehicleCode, 10);
  let rows: TelemetrySyncRow[] = [];

  if (!Number.isNaN(numericCode)) {
    const { data, error } = await supabase
      .from("telemetria_sync")
      .select("pontos, distancia_km")
      .eq("vehicle_code", numericCode)
      .eq("data_jornada", date)
      .limit(1);

    if (error) throw error;
    rows = (data as TelemetrySyncRow[]) || [];
  }

  if (rows.length === 0) {
    const { data, error } = await supabase
      .from("telemetria_sync")
      .select("pontos, distancia_km")
      .eq("veiculo_id", vehicleCode)
      .eq("data_jornada", date)
      .limit(1);

    if (error) throw error;
    rows = (data as TelemetrySyncRow[]) || [];
  }

  return rows[0] ?? null;
}

export default function TelemetryBar({
  vehicleCode,
  date,
  macro1Time = null,
  cursorX = null,
  onCursorChange,
}: TelemetryBarProps) {
  const [points, setPoints] = useState<TelemetryPoint[]>([]);
  const [distanciaKm, setDistanciaKm] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverMinute, setHoverMinute] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastRepairSyncAtRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (cursorX !== null && cursorX !== undefined) setHoverMinute(cursorX);
  }, [cursorX]);

  // ── Fetch ──
  const fetchData = useCallback(async () => {
    const code = String(vehicleCode ?? "").trim();
    if (!code) {
      setPoints([]);
      setDistanciaKm(0);
      setIsLoading(false);
      return;
    }

    try {
      setError(null);

      const numericCode = Number.parseInt(code, 10);
      const canTargetVehicle = !Number.isNaN(numericCode);
      const isToday = date === toDateKey(new Date());
      const syncKey = `${date}:${code}`;
      const now = Date.now();
      const staleThresholdMs = 20 * 60 * 1000;
      const retryCooldownMs = 10 * 60 * 1000;

      const tryRepairSync = async () => {
        if (!isToday || !canTargetVehicle) return false;
        const lastAttemptAt = lastRepairSyncAtRef.current.get(syncKey) ?? 0;
        if (now - lastAttemptAt < retryCooldownMs) return false;

        lastRepairSyncAtRef.current.set(syncKey, now);
        const { error: syncError } = await supabase.functions.invoke("telemetry-sync", {
          body: { date, vehicleCodes: [numericCode] },
        });

        if (syncError) {
          console.error("Erro ao atualizar telemetria em background:", syncError);
          return false;
        }

        return true;
      };

      let row = await fetchTelemetryRow(code, date);

      if (!row) {
        const synced = await tryRepairSync();
        if (synced) {
          row = await fetchTelemetryRow(code, date);
        }
      }

      if (!row) {
        setPoints([]);
        setDistanciaKm(0);
        return;
      }

      let parsedPoints = parseTelemetryPoints(row.pontos);
      let distancia = row.distancia_km ?? 0;
      const latestPointAt = parsedPoints[parsedPoints.length - 1]?.timestamp.getTime() ?? 0;

      if (latestPointAt > 0 && now - latestPointAt > staleThresholdMs) {
        const synced = await tryRepairSync();
        if (synced) {
          const refreshed = await fetchTelemetryRow(code, date);
          if (refreshed) {
            parsedPoints = parseTelemetryPoints(refreshed.pontos);
            distancia = refreshed.distancia_km ?? distancia;
          }
        }
      }

      setDistanciaKm(distancia);
      setPoints(parsedPoints);
    } catch (err: any) {
      console.error("Erro telemetria:", err);
      setError("Erro ao carregar telemetria");
    } finally {
      setIsLoading(false);
    }
  }, [vehicleCode, date]);

  useEffect(() => { setIsLoading(true); fetchData(); }, [fetchData]);
  useEffect(() => {
    const isToday = date === toDateKey(new Date());
    if (!isToday) return;
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [date, fetchData]);

  const segments = useMemo(() => buildSegments(points), [points]);
  const maxSpeed = useMemo(() => {
    if (points.length === 0) return 120;
    return Math.max(120, ...points.map((p) => p.speed));
  }, [points]);

  const hoveredPoint = useMemo(() => {
    if (hoverMinute === null || points.length === 0) return null;
    let closest = points[0];
    let minDiff = Math.abs(points[0].minute - hoverMinute);
    for (const p of points) {
      const diff = Math.abs(p.minute - hoverMinute);
      if (diff < minDiff) { minDiff = diff; closest = p; }
    }
    return minDiff <= 5 ? closest : null;
  }, [hoverMinute, points]);

  // ── Canvas tachograph drawing ──
  const CHART_H = 72;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || points.length === 0) return;

    const w = container.clientWidth;
    canvas.width = w * dpr;
    canvas.height = CHART_H * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${CHART_H}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, CHART_H);

    const toX = (minute: number) => (minute / 1439) * w;
    const toY = (speed: number) => CHART_H - (speed / maxSpeed) * (CHART_H - 4) - 2;

    // Draw state background segments
    for (const seg of segments) {
      const x1 = toX(seg.startMinute);
      const x2 = toX(seg.endMinute);
      ctx.fillStyle = segmentFill(seg.state);
      ctx.fillRect(x1, 0, Math.max(x2 - x1, 1), CHART_H);
    }

    // Draw horizontal speed reference lines
    const speedLines = [30, 60, 80, 100];
    ctx.setLineDash([2, 4]);
    ctx.lineWidth = 0.5;
    for (const spd of speedLines) {
      if (spd > maxSpeed) continue;
      const y = toY(spd);
      ctx.strokeStyle = "rgba(156,163,175,0.35)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();

      // Speed label on left
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(156,163,175,0.5)";
      ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${spd}`, 2, y - 2);
      ctx.setLineDash([2, 4]);
    }
    ctx.setLineDash([]);

    // Draw filled area under speed curve (tachograph style)
    if (points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(toX(points[0].minute), CHART_H);
      for (const p of points) {
        ctx.lineTo(toX(p.minute), toY(p.speed));
      }
      ctx.lineTo(toX(points[points.length - 1].minute), CHART_H);
      ctx.closePath();

      // Gradient fill from green to red based on height
      const grad = ctx.createLinearGradient(0, CHART_H, 0, 0);
      grad.addColorStop(0, "rgba(16,185,129,0.08)");
      grad.addColorStop(0.3, "rgba(16,185,129,0.2)");
      grad.addColorStop(0.6, "rgba(245,158,11,0.2)");
      grad.addColorStop(0.85, "rgba(239,68,68,0.25)");
      grad.addColorStop(1, "rgba(220,38,38,0.35)");
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Draw speed line with per-segment coloring
    ctx.lineWidth = 1.5;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      // Skip large time gaps (> 15 min)
      if (curr.minute - prev.minute > 15) continue;

      ctx.strokeStyle = speedColor(curr.speed);
      ctx.beginPath();
      ctx.moveTo(toX(prev.minute), toY(prev.speed));
      ctx.lineTo(toX(curr.minute), toY(curr.speed));
      ctx.stroke();
    }

    // Draw cursor line
    if (hoverMinute !== null) {
      const cx = toX(hoverMinute);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, CHART_H);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [points, segments, maxSpeed, hoverMinute, dpr]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const minute = Math.round((x / rect.width) * 1439);
      const clamped = Math.max(0, Math.min(1439, minute));
      setHoverMinute(clamped);
      onCursorChange?.(clamped);
    },
    [onCursorChange]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverMinute(null);
    onCursorChange?.(null);
  }, [onCursorChange]);

  const markers = [
    { minute: 0, label: "00:00" },
    { minute: 360, label: "06:00" },
    { minute: 480, label: "08:00" },
    { minute: 720, label: "12:00" },
    { minute: 1080, label: "18:00" },
    { minute: 1439, label: "23:59" },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
        <Activity className="h-3.5 w-3.5 animate-pulse" />
        <span>Carregando telemetria...</span>
      </div>
    );
  }

  if (error) {
    return <div className="text-xs text-destructive py-2">{error}</div>;
  }

  if (points.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
        <Activity className="h-3.5 w-3.5" />
        <span>Sem dados de telemetria para este dia</span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          Tacógrafo Digital
        </h4>
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Gauge className="h-3 w-3" />
            {distanciaKm} km
          </span>
          <span>{points.length} pontos</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-3 text-[10px] text-muted-foreground">
        {(Object.keys(STATE_LABELS) as VehicleState[]).map((state) => (
          <span key={state} className="flex items-center gap-1">
            <span className={`w-2.5 h-2.5 rounded-sm ${STATE_DOT_COLORS[state]} inline-block`} />
            {STATE_LABELS[state]}
          </span>
        ))}
        <span className="flex items-center gap-1 ml-2">
          <span className="w-5 h-2.5 rounded-sm inline-block" style={{ background: "linear-gradient(90deg, rgba(16,185,129,0.8), rgba(245,158,11,0.8), rgba(239,68,68,0.8))" }} />
          Velocidade
        </span>
      </div>

      {/* Time markers */}
      <div className="relative h-4 text-[10px] text-muted-foreground select-none">
        {markers.map((m) => (
          <span
            key={m.minute}
            className="absolute"
            style={{ left: `${(m.minute / 1439) * 100}%`, transform: "translateX(-50%)" }}
          >
            {m.label}
          </span>
        ))}
      </div>

      {/* Tachograph canvas */}
      <div className="relative" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="w-full rounded-sm border border-border cursor-crosshair"
          style={{ height: `${CHART_H}px` }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />

        {/* Tooltip */}
        {hoveredPoint && hoverMinute !== null && (
          <div
            className="absolute bg-popover text-popover-foreground text-xs rounded-md shadow-lg border px-3 py-2 pointer-events-none z-50 whitespace-nowrap"
            style={{
              left: `${(hoverMinute / 1439) * 100}%`,
              top: "-4px",
              transform: "translate(-50%, -100%)",
            }}
          >
            <div className="font-mono font-semibold text-sm">
              {hoveredPoint.timestamp.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Gauge className="h-3 w-3" />
              <span className="font-mono font-bold" style={{ color: speedColor(hoveredPoint.speed) }}>
                {hoveredPoint.speed} km/h
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${STATE_DOT_COLORS[hoveredPoint.state]}`} />
              <span>{STATE_LABELS[hoveredPoint.state]}</span>
            </div>
            <div className="text-muted-foreground text-[10px]">
              Ignição: {hoveredPoint.ignition ? "Ligada" : "Desligada"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
