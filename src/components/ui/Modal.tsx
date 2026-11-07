import { X } from "lucide-react";
import { forwardRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Esc / backdrop clicks are ignored while true (e.g. a request in flight). */
  busy?: boolean;
  title?: React.ReactNode;
  /** Small line under the title. */
  subtitle?: React.ReactNode;
  /** Shown left of the title. */
  icon?: React.ReactNode;
  width?: "sm" | "md" | "lg";
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Above other modals (a confirmation opened from a dialog). */
  layer?: "base" | "top";
}

const WIDTH = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-xl" };

/** Shared modal shell: blurred backdrop, rounded card, header, footer. */
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 flex animate-fade-in items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]",
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
          "flex max-h-[88vh] w-full animate-pop-in flex-col overflow-hidden rounded-2xl border border-app-border bg-app-panel shadow-2xl",
          WIDTH[width],
        )}
      >
        {title !== undefined && (
          <div className="flex items-start gap-3 px-5 pb-1 pt-5">
            {icon}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="text-base font-semibold leading-6">{title}</div>
              {subtitle && <div className="text-xs leading-5 text-app-muted">{subtitle}</div>}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="关闭"
              className="-mr-1 -mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-app-muted transition-colors hover:bg-app-subtle hover:text-app-fg disabled:opacity-40"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-app-border bg-app-subtle/30 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: React.ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-app-accent text-white shadow-sm hover:brightness-110 active:brightness-95",
  secondary: "border border-app-border bg-app-panel text-app-fg hover:bg-app-subtle",
  ghost: "text-app-fg/80 hover:bg-app-subtle hover:text-app-fg",
  danger: "bg-red-600 text-white shadow-sm hover:bg-red-700",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, className, ...rest },
  ref,
) {
  return (
    <label className="flex flex-col gap-1.5">
      {label && <span className="text-xs font-medium text-app-fg/70">{label}</span>}
      <input
        ref={ref}
        className={cn(
          "h-9 rounded-lg border bg-app-subtle/60 px-3 text-sm outline-none transition placeholder:text-app-muted/70",
          "focus:border-app-accent/60 focus:bg-app-panel focus:ring-4 focus:ring-app-accent/10",
          error ? "border-red-500/60" : "border-app-border",
          className,
        )}
        {...rest}
      />
      {error ? (
        <span className="text-xs text-red-500">{error}</span>
      ) : (
        hint && <span className="text-xs text-app-muted">{hint}</span>
      )}
    </label>
  );
});

/** Inline notice box used in dialogs and settings. */
export function Notice({
  tone = "info",
  icon,
  children,
  className,
}: {
  tone?: "info" | "warn" | "danger" | "success";
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-app-accent/20 bg-app-accent/5 text-app-fg/80",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    danger: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
    success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  };
  return (
    <div className={cn("flex gap-2.5 rounded-xl border px-3 py-2.5 text-xs leading-5", tones[tone], className)}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** iOS-style switch. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-40",
        checked ? "bg-app-accent" : "bg-app-border",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
