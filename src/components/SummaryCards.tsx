import { Truck, Play, Coffee, Moon, Bed, Zap, Sun, AlertTriangle } from "lucide-react";
import { useMemo } from "react";
import { useJourneyStore } from "@/context/JourneyContext";
import { calculateJourneyForDate, getJourneyForDate } from "@/lib/journeyEngine";

interface SummaryCardsProps {
  activeFilter?: string;
  onFilterChange?: (filter: string) => void;
}

const DOT_COLORS: Record<string, string> = {
  all: "bg-primary",
  em_jornada: "bg-status-journey",
  em_refeicao: "bg-status-meal",
  em_repouso: "bg-status-rest",
  em_complemento: "bg-status-complement",
  em_interjornada: "bg-status-end",
  em_folga: "bg-muted-foreground/40",
  alertas: "bg-destructive",
};

export default function SummaryCards({ activeFilter = "all", onFilterChange }: SummaryCardsProps) {
  const { vehicles, getVehicleJourneys, selectedDate, folgaVehicles, getDayMark } = useJourneyStore();
  const now = useMemo(() => new Date(), []);

  const stats = useMemo(() => {
    let emJornada = 0;
    let emRefeicao = 0;
    let emRepouso = 0;
    let emComplemento = 0;
    let emInterjornada = 0;
    let emFolga = 0;
    let alertas = 0;

    for (const v of vehicles) {
      const mark = getDayMark(v.id, selectedDate);
      if (folgaVehicles.has(v.id) || (mark && mark.type === "folga")) {
        emFolga++;
        continue;
      }
      if (mark) {
        emFolga++;
        continue;
      }

      const journeys = getVehicleJourneys(v.id);
      const todayJourney = getJourneyForDate(journeys, selectedDate, now);

      if (todayJourney) {
        const calc = calculateJourneyForDate(todayJourney, selectedDate, now);
        if (calc.status === "em_jornada") emJornada++;
        else if (calc.status === "em_refeicao") emRefeicao++;
        else if (calc.status === "em_repouso") emRepouso++;
        else if (calc.status === "em_complemento") emComplemento++;
        else if (calc.status === "em_interjornada") emInterjornada++;
        if (calc.mealAlert || calc.overtimeMinutes > 0) alertas++;
      } else {
        emInterjornada++;
      }
    }

    return { total: vehicles.length, emJornada, emRefeicao, emRepouso, emComplemento, emInterjornada, emFolga, alertas };
  }, [vehicles, getVehicleJourneys, selectedDate, now, folgaVehicles, getDayMark]);

  const cards = [
    { label: "Total", value: stats.total, icon: Truck, filter: "all" },
    { label: "Em Jornada", value: stats.emJornada, icon: Play, filter: "em_jornada" },
    { label: "Refeição", value: stats.emRefeicao, icon: Coffee, filter: "em_refeicao" },
    { label: "Repouso", value: stats.emRepouso, icon: Bed, filter: "em_repouso" },
    { label: "Complemento", value: stats.emComplemento, icon: Zap, filter: "em_complemento" },
    { label: "Interjornada", value: stats.emInterjornada, icon: Moon, filter: "em_interjornada" },
    { label: "Folga", value: stats.emFolga, icon: Sun, filter: "em_folga" },
    { label: "Alertas", value: stats.alertas, icon: AlertTriangle, filter: "alertas" },
  ];

  return (
    <div className="flex items-stretch bg-card rounded-md border divide-x divide-border overflow-x-auto">
      {cards.map((card) => {
        const isActive = activeFilter === card.filter;
        const dotColor = DOT_COLORS[card.filter] || "bg-muted";
        return (
          <button
            key={card.filter}
            onClick={() => onFilterChange?.(card.filter)}
            className={`flex-1 min-w-[100px] flex items-center gap-2.5 px-3 py-2.5 text-left transition-all relative ${
              isActive
                ? "bg-muted/60"
                : "hover:bg-muted/30"
            }`}
          >
            {isActive && (
              <div className={`absolute bottom-0 left-2 right-2 h-0.5 rounded-full ${dotColor}`} />
            )}
            <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor} ${isActive ? "" : "opacity-60"}`} />
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground leading-none truncate">{card.label}</p>
              <p className="text-lg font-bold leading-tight tabular-nums text-foreground">{card.value}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
