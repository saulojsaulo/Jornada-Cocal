import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DayMarkType, DAY_MARK_LABELS, DAY_MARK_ICONS } from "./MovimentoCondutorTab";

interface DayMarkDialogProps {
  open: boolean;
  onClose: () => void;
  date: string;
  vehicleCode: string;
  onConfirm: (data: { type: DayMarkType; reason: string; date: string; vehicleCode: string }) => Promise<void>;
}

const MARK_TYPES: DayMarkType[] = ["folga", "falta", "atestado", "afastamento"];

export default function DayMarkDialog({ open, onClose, date, vehicleCode, onConfirm }: DayMarkDialogProps) {
  const [markType, setMarkType] = useState<DayMarkType>("folga");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const dateStr = date
    ? new Date(date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "";

  const handleSubmit = async () => {
    if (!reason.trim()) return;
    setLoading(true);
    try {
      await onConfirm({ type: markType, reason: reason.trim(), date, vehicleCode });
      setReason("");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">📅 Marcar Dia — {dateStr}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Tipo de Marcação</Label>
            <Select value={markType} onValueChange={(v) => setMarkType(v as DayMarkType)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MARK_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">
                    {DAY_MARK_ICONS[t]} {DAY_MARK_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Justificativa *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descreva o motivo da marcação..."
              className="text-xs min-h-[60px]"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={loading || !reason.trim()}>
            {loading ? "Salvando..." : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
