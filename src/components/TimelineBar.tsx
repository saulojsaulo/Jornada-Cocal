import { useMemo, useState } from "react";
import { TimelineSegment, VehicleStatus } from "@/types/journey";
import { formatMinutes } from "@/lib/journeyEngine";

const STATUS_COLORS: Record<string, string> = {
  em_jornada: "bg-status-journey",
  em_refeicao: "bg-status-meal",
  em_repouso: "bg-status-rest",
  em_complemento: "bg-status-complement",
  em_interjornada: "bg-status-end",
  interjornada: "bg-status-interjournada",
  inactive: "bg-status-inactive",
};

const STATUS_LABELS: Record<string, string> = {
  em_jornada: "Em Jornada",
  em_refeicao: "Em Refeição",
  em_repouso: "Em Repouso",
  em_complemento: "Em Complemento",
  em_interjornada: "Em Interjornada",
  interjornada: "Interjornada",
  inactive: "Sem Atividade",
};

interface TimelineBarProps {
  segments: TimelineSegment[];
  showPreviousDay: boolean;
  onTogglePreviousDay: () => void;
}

export default function TimelineBar({ segments, showPreviousDay, onTogglePreviousDay }: TimelineBarProps) {
  const [tooltip, setTooltip] = useState<{ x: number; content: string } | null>(null);

  const filteredSegments = useMemo(() => {
    if (showPreviousDay) return segments;
    return segments.map(s => 
      s.isPreviousDay ? { ...s, status: "inactive" as const, isPreviousDay: false } : s
    );
  }, [segments, showPreviousDay]);

  const markers = [
    { minute: 0, label: "00:00" },
    { minute: 360, label: "06:00" },
    { minute: 480, label: "08:00" },
    { minute: 720, label: "12:00" },
    { minute: 1080, label: "18:00" },
    { minute: 1439, label: "23:59" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-status-journey inline-block" /> Jornada</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-status-meal inline-block" /> Refeição</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-status-rest inline-block" /> Repouso</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-status-complement inline-block" /> Complemento</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-status-end inline-block" /> Fim</span>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showPreviousDay}
            onChange={onTogglePreviousDay}
            className="rounded"
          />
          Exibir jornada do dia anterior
        </label>
      </div>

      {/* Timeline bar */}
      <div className="relative">
        {/* Markers */}
        <div className="flex justify-between text-[10px] text-muted-foreground mb-1 px-0">
          {markers.map(m => (
            <span key={m.minute} style={{ position: "absolute", left: `${(m.minute / 1439) * 100}%`, transform: "translateX(-50%)" }}>
              {m.label}
            </span>
          ))}
        </div>

        <div
          className="relative h-8 rounded-md overflow-hidden border border-border mt-5 flex"
          onMouseLeave={() => setTooltip(null)}
        >
          {filteredSegments.map((seg, i) => {
            const width = ((seg.endMinute - seg.startMinute) / 1439) * 100;
            if (width <= 0) return null;

            return (
              <div
                key={i}
                className={`${STATUS_COLORS[seg.status]} ${seg.isPreviousDay ? "opacity-50 border-dashed border-r border-foreground/20" : ""} relative transition-all cursor-pointer`}
                style={{ width: `${width}%` }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const parentRect = e.currentTarget.parentElement!.getBoundingClientRect();
                  const x = rect.left - parentRect.left + rect.width / 2;
                  const timeStr = `${formatMinutes(seg.startMinute)} - ${formatMinutes(seg.endMinute)}`;
                  const statusLabel = STATUS_LABELS[seg.status] || seg.status;
                  let content = `${timeStr}\n${statusLabel}`;
                  if (seg.isPreviousDay) content += "\n⚠ Jornada do dia anterior";
                  if (seg.journeyDate) content += `\nJornada: ${seg.journeyDate}`;
                  setTooltip({ x, content });
                }}
              >
                {seg.isPreviousDay && width > 3 && (
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] text-foreground/50 truncate px-1">
                    Dia anterior
                  </span>
                )}
              </div>
            );
          })}

          {/* 8h and 12h reference lines */}
          <div className="absolute top-0 bottom-0 border-l border-dashed border-foreground/20" style={{ left: `${(480 / 1439) * 100}%` }} />
          <div className="absolute top-0 bottom-0 border-l border-dashed border-destructive/40" style={{ left: `${(720 / 1439) * 100}%` }} />
        </div>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute -top-16 bg-popover text-popover-foreground text-xs rounded-md shadow-lg border px-3 py-2 pointer-events-none z-50 whitespace-pre-line"
            style={{ left: tooltip.x, transform: "translateX(-50%)" }}
          >
            {tooltip.content}
          </div>
        )}
      </div>
    </div>
  );
}
