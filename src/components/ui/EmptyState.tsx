import { cn } from "../../lib/cn";

/** Centered placeholder for an empty area: icon, one line, optional action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1 px-6 text-center", className)}>
      {icon && <div className="mb-2 text-app-muted">{icon}</div>}
      <div className="text-sm font-medium text-app-fg">{title}</div>
      {description && <div className="max-w-[260px] text-xs text-app-muted">{description}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
