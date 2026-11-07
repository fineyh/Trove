import { Lock, Map, MessageCircle, Plus, Settings, Settings2 } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { useLibrariesStore } from "../../stores/libraries";
import { useSecurityStore } from "../../stores/security";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import type { LibraryInfo } from "../../types";
import { LibraryAvatar } from "../library/LibraryAvatar";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";

/** Hover label that floats to the right of a rail button. */
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-app-fg px-2.5 py-1 text-xs font-medium text-app-panel opacity-0 shadow-lg transition-opacity delay-150 group-hover:opacity-100">
      {children}
    </span>
  );
}

interface RailButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
}

function RailButton({ icon, label, onClick, active }: RailButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
        active
          ? "bg-app-accent/10 text-app-accent"
          : "text-app-fg/60 hover:bg-app-subtle hover:text-app-fg",
      )}
    >
      {icon}
      <Tip>{label}</Tip>
    </button>
  );
}

function LibraryButton({
  lib,
  active,
  onContextMenu,
}: {
  lib: LibraryInfo;
  active: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const select = useLibrariesStore((s) => s.select);
  const locked = lib.encrypted && !lib.unlocked;
  return (
    <button
      type="button"
      onClick={() => select(lib.id)}
      onContextMenu={onContextMenu}
      aria-label={lib.name}
      aria-current={active}
      className="group relative flex h-11 w-full items-center justify-center"
    >
      {/* Active / hover pill on the rail's left edge. */}
      <span
        className={cn(
          "absolute left-0 w-1 rounded-r-full bg-app-fg transition-all duration-200",
          active ? "h-7 opacity-100" : "h-2 opacity-0 group-hover:h-4 group-hover:opacity-60",
        )}
      />
      <span
        className={cn(
          "transition-transform duration-200",
          active ? "scale-100" : "scale-[0.92] group-hover:scale-100",
        )}
      >
        <LibraryAvatar name={lib.name} icon={lib.icon} color={lib.color} size={40} locked={locked} />
      </span>
      <Tip>
        {lib.name}
        {lib.encrypted && (
          <span className="ml-1.5 opacity-70">{lib.unlocked ? "· 已解锁" : "· 已锁定"}</span>
        )}
      </Tip>
    </button>
  );
}

export function Sidebar() {
  const libraries = useLibrariesStore((s) => s.list);
  const current = useLibrariesStore((s) => s.current);
  const appPassword = useSecurityStore((s) => s.status?.appPassword === true);
  const lockApp = useSecurityStore((s) => s.lock);
  const setSettingsOpen = useSessionStore((s) => s.setSettingsOpen);
  const setMapOpen = useSessionStore((s) => s.setMapOpen);
  const mapOpen = useSessionStore((s) => s.mapOpen);
  const setLibraryDialog = useSessionStore((s) => s.setLibraryDialog);
  const [menu, setMenu] = useState<{ lib: LibraryInfo; x: number; y: number } | null>(null);

  const menuItems: ContextMenuItem[] = [];
  if (menu) {
    const l = menu.lib;
    menuItems.push({
      label: "库设置…",
      icon: <Settings2 size={14} />,
      onClick: () => {
        setMenu(null);
        setLibraryDialog({ mode: "settings", id: l.id });
      },
    });
    if (l.encrypted && l.unlocked) {
      menuItems.push({
        label: "立即上锁",
        icon: <Lock size={14} />,
        onClick: () => {
          setMenu(null);
          void useLibrariesStore
            .getState()
            .lock(l.id)
            .catch((e) => toast.error("上锁失败", e));
        },
      });
    }
  }

  return (
    <aside className="flex h-full w-[68px] shrink-0 flex-col items-center border-r border-app-border bg-app-panel py-3">
      {/* No overflow here: it would clip the hover labels. */}
      <nav className="flex w-full flex-col items-center gap-1.5">
        {libraries.map((l) => (
          <LibraryButton
            key={l.id}
            lib={l}
            active={l.id === current}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ lib: l, x: e.clientX, y: e.clientY });
            }}
          />
        ))}
        <button
          type="button"
          onClick={() => setLibraryDialog({ mode: "create" })}
          aria-label="新建库"
          className="group relative mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-app-border text-app-muted transition-colors hover:border-app-accent/60 hover:bg-app-accent/5 hover:text-app-accent"
        >
          <Plus size={18} />
          <Tip>新建库</Tip>
        </button>
      </nav>

      <div className="my-3 h-px w-8 bg-app-border" />

      <div className="flex flex-col items-center gap-1">
        <RailButton
          icon={<MessageCircle size={19} />}
          label="会话"
          onClick={() => setMapOpen(false)}
          active={!mapOpen}
        />
        <RailButton
          icon={<Map size={19} />}
          label="地图"
          onClick={() => setMapOpen(true)}
          active={mapOpen}
        />
      </div>

      <div className="flex-1" />

      <div className="flex flex-col items-center gap-1">
        {appPassword && (
          <RailButton
            icon={<Lock size={18} />}
            label="锁定 Trove"
            onClick={() => void lockApp().catch((e) => toast.error("锁定失败", e))}
          />
        )}
        <RailButton icon={<Settings size={19} />} label="设置" onClick={() => setSettingsOpen(true)} />
      </div>

      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
        onClose={() => setMenu(null)}
      />
    </aside>
  );
}
