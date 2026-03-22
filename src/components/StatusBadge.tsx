import { VehicleStatus, STATUS_LABELS } from "@/types/journey";

const STATUS_DOT_CLASSES: Record<VehicleStatus, string> = {
  em_jornada: "bg-status-journey",
  em_refeicao: "bg-status-meal",
  em_repouso: "bg-status-rest",
  em_complemento: "bg-status-complement",
  em_interjornada: "bg-status-end",
  em_folga: "bg-muted-foreground/40",
};

const STATUS_TEXT_CLASSES: Record<VehicleStatus, string> = {
  em_jornada: "text-status-journey",
  em_refeicao: "text-status-meal",
  em_repouso: "text-status-rest",
  em_complemento: "text-status-complement",
  em_interjornada: "text-status-end",
  em_folga: "text-muted-foreground",
};

export default function StatusBadge({ status, size = "md" }: { status: VehicleStatus; size?: "sm" | "md" }) {
  const sizeClasses = size === "sm"
    ? "px-1.5 py-0 text-[10px] gap-1"
    : "px-2 py-0.5 text-xs gap-1.5";
  const dotSize = size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2";

  return (
    <span
      className={`inline-flex items-center font-medium whitespace-nowrap rounded ${sizeClasses} bg-muted/60 border border-border/50`}
    >
      <span className={`${dotSize} rounded-full shrink-0 ${STATUS_DOT_CLASSES[status]}`} />
      <span className={STATUS_TEXT_CLASSES[status]}>{STATUS_LABELS[status]}</span>
    </span>
  );
}
