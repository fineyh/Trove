import { cn } from "../../lib/cn";

interface SegmentedProps<T extends string | number> {
  value: T;
  options: readonly { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}

/** A small set of mutually exclusive choices, inline. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = "sm",
  className,
}: SegmentedProps<T>) {
  return (
    <div role="radiogroup" className={cn("inline-flex shrink-0 rounded-lg bg-app-subtle p-0.5", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 rounded-md px-2.5 font-medium transition-colors duration-fast",
              size === "sm" ? "h-6 text-xs" : "h-7 text-sm",
              on
                ? "bg-app-panel text-app-fg shadow-sm dark:bg-[rgb(var(--line))]"
                : "text-app-secondary hover:text-app-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
