import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MacroNumber, MACRO_LABELS } from "@/types/journey";

interface MacroEditDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "insert" | "edit" | "delete";
  vehicleCode: string;
  initialMacroNumber?: MacroNumber;
  initialDateTime?: Date;
  originalEventId?: string;
  onConfirm: (data: {
    action: "insert" | "edit" | "delete";
    macroNumber?: MacroNumber;
    eventTime?: string;
    reason: string;
    originalEventId?: string;
    originalMacroNumber?: number;
    originalEventTime?: string;
  }) => Promise<void>;
}

const VALID_MACROS: MacroNumber[] = [1, 2, 3, 4, 5, 6, 9, 10];

export default function MacroEditDialog({
  open,
  onClose,
  mode,
  initialMacroNumber,
  initialDateTime,
  originalEventId,
  onConfirm,
}: MacroEditDialogProps) {
  const [macroNumber, setMacroNumber] = useState<string>(
    initialMacroNumber ? String(initialMacroNumber) : "1"
  );
  const [dateTime, setDateTime] = useState<string>(
    initialDateTime
      ? formatDateTimeLocal(initialDateTime)
      : formatDateTimeLocal(new Date())
  );
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const titles: Record<string, string> = {
    insert: "➕ Inserir Macro Manual",
    edit: "✏️ Editar Macro",
    delete: "🗑️ Excluir Macro",
  };

  const handleSubmit = async () => {
    if (!reason.trim()) return;
    setLoading(true);
    try {
      await onConfirm({
        action: mode,
        macroNumber: mode !== "delete" ? (Number(macroNumber) as MacroNumber) : undefined,
        eventTime: mode !== "delete" ? new Date(dateTime).toISOString() : undefined,
        reason: reason.trim(),
        originalEventId,
        originalMacroNumber: initialMacroNumber,
        originalEventTime: initialDateTime?.toISOString(),
      });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{titles[mode]}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {mode === "delete" && initialMacroNumber && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-md p-3 text-sm">
              <p>
                Excluir macro{" "}
                <strong>{MACRO_LABELS[initialMacroNumber]}</strong> de{" "}
                {initialDateTime?.toLocaleString("pt-BR")}?
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                O evento original será mantido no banco de dados para auditoria.
              </p>
            </div>
          )}

          {mode !== "delete" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Macro</Label>
                <Select value={macroNumber} onValueChange={setMacroNumber}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VALID_MACROS.map((m) => (
                      <SelectItem key={m} value={String(m)} className="text-xs">
                        M{m} — {MACRO_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Data / Hora</Label>
                <Input
                  type="datetime-local"
                  value={dateTime}
                  onChange={(e) => setDateTime(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Motivo da alteração *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descreva o motivo da alteração manual..."
              className="text-xs min-h-[60px]"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            size="sm"
            variant={mode === "delete" ? "destructive" : "default"}
            onClick={handleSubmit}
            disabled={loading || !reason.trim()}
          >
            {loading ? "Salvando..." : mode === "delete" ? "Excluir" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDateTimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
