import { AlertTriangle, X } from "lucide-react";
import { useEffect } from "react";
import { cn } from "../../lib/cn";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "default";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "确认",
  cancelText = "取消",
  variant = "default",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const isDanger = variant === "danger";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-app-border bg-app-panel p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-base font-semibold">
            {isDanger && <AlertTriangle size={16} className="text-red-500" />}
            {title}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex h-7 w-7 items-center justify-center rounded text-app-muted hover:bg-app-subtle disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        <div className="text-sm text-app-fg/80">{message}</div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-app-border px-3 py-1.5 text-sm hover:bg-app-subtle disabled:opacity-40"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-40",
              isDanger ? "bg-red-600 hover:bg-red-700" : "bg-app-accent",
            )}
          >
            {busy ? "处理中..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
