import { cn } from "../../lib/cn";

type Tone = "info" | "warn" | "danger" | "success";

const TONE: Record<Tone, string> = {
  info: "bg-app-subtle text-app-secondary",
  warn: "bg-app-warning/10 text-app-warning",
  danger: "bg-app-danger/10 text-app-danger",
  success: "bg-app-success/10 text-app-success",
};

/** A short inline message. One sentence, no title. */
export function Notice({
  tone = "info",
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-2 rounded-lg px-3 py-2 text-xs leading-[18px]", TONE[tone], className)}>
      {icon && <span className="mt-px shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
