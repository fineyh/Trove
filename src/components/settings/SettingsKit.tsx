import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";

/**
 * The one layout every settings page uses:
 *
 *   <Page title>
 *     <Group title footer>
 *       <Row label description> control </Row>
 *
 * A row's control sits on the right: Switch, Segmented, Select, a Button, or a
 * value with a chevron (pass onClick). `expanded` shows an inline form under
 * the row, inside the same card.
 */

export function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6 pb-6">
      <h1 className="text-lg font-semibold">{title}</h1>
      {children}
    </div>
  );
}

export function Group({
  title,
  action,
  footer,
  children,
}: {
  title?: string;
  /** Small control at the right end of the title line. */
  action?: React.ReactNode;
  /** One line under the card. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      {(title || action) && (
        <div className="flex h-6 items-end justify-between px-1">
          <h2 className="text-xs font-medium text-app-secondary">{title}</h2>
          {action}
        </div>
      )}
      <div className="divide-y divide-app-border overflow-hidden rounded-xl border border-app-border bg-app-panel">
        {children}
      </div>
      {footer && <p className="px-1 text-xs text-app-muted">{footer}</p>}
    </section>
  );
}

interface RowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** Leading visual (avatar, icon tile). */
  leading?: React.ReactNode;
  children?: React.ReactNode;
  /** Whole row navigates somewhere: shows a chevron after the control. */
  onClick?: () => void;
  danger?: boolean;
  expanded?: React.ReactNode;
}

export function Row({ label, description, leading, children, onClick, danger, expanded }: RowProps) {
  const body = (
    <>
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn("text-sm", danger ? "text-app-danger" : "text-app-fg")}>{label}</span>
        {description && <span className="text-xs text-app-muted">{description}</span>}
      </div>
      {children !== undefined && <div className="flex shrink-0 items-center gap-2 text-sm text-app-secondary">{children}</div>}
      {onClick && <ChevronRight size={16} className="-mr-1 shrink-0 text-app-muted" />}
    </>
  );
  const rowClass = "flex min-h-[48px] w-full items-center gap-3 px-4 py-2.5 text-left";
  return (
    <div>
      {onClick ? (
        <button type="button" onClick={onClick} className={cn(rowClass, "transition-colors duration-fast hover:bg-app-hover/[0.03]")}>
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
      {expanded && <div className="flex flex-col gap-3 px-4 pb-4 pt-1">{expanded}</div>}
    </div>
  );
}

/** Two short numbers side by side, for the top of a group. */
export function Stats({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <div className="grid grid-flow-col divide-x divide-app-border">
      {items.map((it) => (
        <div key={it.label} className="flex flex-col gap-0.5 px-4 py-3">
          <span className="text-xs text-app-muted">{it.label}</span>
          <span className="truncate text-base font-semibold">{it.value}</span>
        </div>
      ))}
    </div>
  );
}
