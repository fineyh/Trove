import { cn } from "../../lib/cn";
import { NAV_ITEMS, type SettingsSection } from "./types";

interface SettingsNavProps {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}

export function SettingsNav({ active, onSelect }: SettingsNavProps) {
  return (
    <nav className="flex h-full w-[200px] shrink-0 flex-col gap-0.5 border-r border-app-border bg-app-panel p-3">
      <div className="px-2.5 pb-3 pt-1 text-base font-semibold">设置</div>
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const on = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-fast",
              on ? "bg-app-hover/[0.07] font-medium text-app-fg" : "text-app-secondary hover:bg-app-hover/[0.04] hover:text-app-fg",
            )}
          >
            <Icon size={16} className={cn("shrink-0", on ? "text-app-accent" : "")} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
