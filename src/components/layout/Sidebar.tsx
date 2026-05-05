import { Lock, Settings, User } from "lucide-react";
import { useSessionStore } from "../../stores/session";
import { cn } from "../../lib/cn";

interface SidebarButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
}

function SidebarButton({ icon, label, onClick, active }: SidebarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
        "hover:bg-app-subtle text-app-fg/70 hover:text-app-fg",
        active && "bg-app-subtle text-app-fg",
      )}
    >
      {icon}
    </button>
  );
}

export function Sidebar() {
  const setSettingsOpen = useSessionStore((s) => s.setSettingsOpen);
  return (
    <aside className="flex h-full w-16 shrink-0 flex-col items-center border-r border-app-border bg-app-panel py-3">
      <button
        type="button"
        title="个人资料"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-app-subtle text-app-fg/70 hover:text-app-fg"
      >
        <User size={18} />
      </button>

      <div className="flex-1" />

      <div className="flex flex-col gap-1">
        <SidebarButton icon={<Lock size={18} />} label="锁定" />
        <SidebarButton
          icon={<Settings size={18} />}
          label="设置"
          onClick={() => setSettingsOpen(true)}
        />
      </div>
    </aside>
  );
}
