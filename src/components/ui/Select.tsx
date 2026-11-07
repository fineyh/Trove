import { Check, ChevronsUpDown } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { ContextMenu } from "./ContextMenu";

interface SelectProps<T extends string | number> {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
  className?: string;
}

/** A compact dropdown: a button showing the value, a menu of choices. */
export function Select<T extends string | number>({ value, options, onChange, label, className }: SelectProps<T>) {
  const ref = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const current = options.find((o) => o.value === value);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        onClick={() => {
          const r = ref.current?.getBoundingClientRect();
          if (r) setAt({ x: r.left, y: r.bottom + 4 });
        }}
        className={cn(
          "inline-flex h-8 min-w-[120px] shrink-0 items-center justify-between gap-2 rounded-lg border border-app-border bg-app-panel pl-3 pr-2 text-sm transition-colors duration-fast hover:bg-app-hover/5",
          className,
        )}
      >
        <span className="truncate">{current?.label ?? ""}</span>
        <ChevronsUpDown size={14} className="shrink-0 text-app-muted" />
      </button>
      <ContextMenu
        open={at !== null}
        x={at?.x ?? 0}
        y={at?.y ?? 0}
        onClose={() => setAt(null)}
        items={options.map((o) => ({
          label: o.label,
          icon: o.value === value ? <Check size={14} className="text-app-accent" /> : <span />,
          onClick: () => {
            setAt(null);
            onChange(o.value);
          },
        }))}
      />
    </>
  );
}
