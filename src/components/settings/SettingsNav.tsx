import { cn } from "../../lib/cn";
import { NAV_ITEMS, type SettingsSection } from "./types";

interface SettingsNavProps {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}

export function SettingsNav({ active, onSelect }: SettingsNavProps) {
  return (
    <nav className="flex h-full w-44 shrink-0 flex-col gap-0.5 border-r border-app-border bg-app-subtle/40 p-2">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-app-panel text-app-fg shadow-sm"
                : "text-app-fg/70 hover:bg-app-panel/60 hover:text-app-fg",
            )}
          >
            <Icon size={15} className="shrink-0" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
