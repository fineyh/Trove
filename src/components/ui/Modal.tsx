import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { IconButton } from "./Button";

// Re-exported so existing imports from "ui/Modal" keep working.
export { Button, IconButton } from "./Button";
export { TextField } from "./Field";
export { Notice } from "./Notice";
export { Switch } from "./Switch";

// ─── Escape stack ───────────────────────────────────────────────────────────
// Several layers can be open at once (settings → confirm). Esc closes only the
// topmost one.

const stack: { current: () => void }[] = [];

export function useEscapeLayer(open: boolean, onEscape: () => void) {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    if (!open) return;
    const entry = { current: () => ref.current() };
    stack.push(entry);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || stack[stack.length - 1] !== entry) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      entry.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open]);
}

// ─── Modal ──────────────────────────────────────────────────────────────────

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Esc / backdrop clicks are ignored while true (e.g. a request in flight). */
  busy?: boolean;
  title?: React.ReactNode;
  /** One short line under the title. */
  subtitle?: React.ReactNode;
  /** Shown left of the title. */
  icon?: React.ReactNode;
  width?: "sm" | "md" | "lg";
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Above other modals (a confirmation opened from a dialog). */
  layer?: "base" | "top";
}

const WIDTH = { sm: "max-w-[360px]", md: "max-w-[440px]", lg: "max-w-[560px]" };

export function Modal({
  open,
  onClose,
  busy = false,
  title,
  subtitle,
  icon,
  width = "md",
  children,
  footer,
  layer = "base",
}: ModalProps) {
  useEscapeLayer(open, () => {
    if (!busy) onClose();
  });

  if (!open) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 flex animate-fade-in items-center justify-center bg-black/30 p-6 dark:bg-black/50",
        layer === "top" ? "z-[60]" : "z-50",
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "flex max-h-[88vh] w-full animate-pop-in flex-col overflow-hidden rounded-2xl bg-app-panel shadow-xl ring-1 ring-black/5 dark:ring-white/10",
          WIDTH[width],
        )}
      >
        {title !== undefined && (
          <div className="flex items-start gap-3 px-5 pt-4">
            {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
            <div className="flex min-w-0 flex-1 flex-col pt-1">
              <div className="truncate text-base font-semibold">{title}</div>
              {subtitle && <div className="text-xs text-app-muted">{subtitle}</div>}
            </div>
            <IconButton
              label="关闭"
              noTip
              size="sm"
              icon={<X size={16} />}
              onClick={onClose}
              disabled={busy}
              className="-mr-2"
            />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 px-5 pb-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
