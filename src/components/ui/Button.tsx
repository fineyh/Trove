import { Loader2 } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-secondary";
type Size = "sm" | "md";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
  /** Replaces the icon with a spinner and blocks clicks. */
  loading?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary: "bg-app-accent text-app-on-accent hover:bg-app-accent/90 active:bg-app-accent/80",
  secondary: "border border-app-border bg-app-panel text-app-fg hover:bg-app-hover/5 active:bg-app-hover/10",
  ghost: "text-app-fg hover:bg-app-hover/5 active:bg-app-hover/10",
  danger: "bg-app-danger text-white hover:bg-app-danger/90 active:bg-app-danger/80",
  "danger-secondary":
    "border border-app-border bg-app-panel text-app-danger hover:bg-app-danger/[0.06] active:bg-app-danger/10",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-xs",
  md: "h-8 gap-1.5 px-3 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors duration-fast",
        "disabled:pointer-events-none disabled:opacity-45",
        SIZE[size],
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={size === "sm" ? 12 : 14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Accessible name and tooltip. */
  label: string;
  icon: React.ReactNode;
  size?: "sm" | "md" | "lg";
  active?: boolean;
  tipSide?: "top" | "bottom" | "left" | "right";
  /** No tooltip, e.g. when the label is visible next to it. */
  noTip?: boolean;
}

const ICON_SIZE = { sm: "h-7 w-7", md: "h-8 w-8", lg: "h-9 w-9" };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = "md", active, tipSide, noTip, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      data-tip={noTip ? undefined : label}
      data-tip-side={tipSide}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg transition-colors duration-fast disabled:pointer-events-none disabled:opacity-40",
        ICON_SIZE[size],
        active
          ? "bg-app-accent/10 text-app-accent"
          : "text-app-secondary hover:bg-app-hover/5 hover:text-app-fg active:bg-app-hover/10",
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});
