import { Lock, Map, MessageCircle, Plus, Settings, Settings2 } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { useLibrariesStore } from "../../stores/libraries";
import { useSecurityStore } from "../../stores/security";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import { useUpdateStore } from "../../stores/update";
import type { LibraryInfo } from "../../types";
import { LibraryAvatar } from "../library/LibraryAvatar";
import { IconButton } from "../ui/Button";
import { UpdateDot } from "../ui/UpdateDot";
import { ContextMenu, type ContextMenuEntry } from "../ui/ContextMenu";

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
      data-tip={locked ? `${lib.name}（已锁定）` : lib.name}
      data-tip-side="right"
      className="group relative flex h-11 w-full items-center justify-center"
    >
      <span
        className={cn(
          "absolute left-0 w-[3px] rounded-r-full bg-app-fg transition-all duration-slow",
          active ? "h-6 opacity-100" : "h-2 opacity-0 group-hover:h-3 group-hover:opacity-40",
        )}
      />
      <span className={cn("transition-opacity duration-fast", active ? "" : "opacity-80 group-hover:opacity-100")}>
        <LibraryAvatar name={lib.name} icon={lib.icon} color={lib.color} size={36} locked={locked} />
      </span>
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
  const updateReady = useUpdateStore((s) => s.info?.available === true);
  const [menu, setMenu] = useState<{ lib: LibraryInfo; x: number; y: number } | null>(null);

  const menuItems: ContextMenuEntry[] = [];
  if (menu) {
    const l = menu.lib;
    menuItems.push({
      label: "库设置",
      icon: <Settings2 size={15} />,
      onClick: () => {
        setMenu(null);
        setLibraryDialog({ mode: "settings", id: l.id });
      },
    });
    if (l.encrypted && l.unlocked) {
      menuItems.push({
        label: "锁定",
        icon: <Lock size={15} />,
        onClick: () => {
          setMenu(null);
          void useLibrariesStore
            .getState()
            .lock(l.id)
            .catch((e) => toast.error("锁定失败", e));
        },
      });
    }
  }

  return (
    <aside
      data-drag-region
      className="flex h-full w-16 shrink-0 flex-col items-center bg-app pb-3 pt-[calc(12px+var(--chrome-top))]"
    >
      <nav className="flex w-full flex-col items-center gap-1">
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
        <IconButton
          label="新建库"
          tipSide="right"
          size="lg"
          icon={<Plus size={18} />}
          onClick={() => setLibraryDialog({ mode: "create" })}
          className="mt-1"
        />
      </nav>

      <div className="my-3 h-px w-6 bg-app-border" />

      <div className="flex flex-col items-center gap-1">
        <IconButton
          label="会话"
          tipSide="right"
          size="lg"
          icon={<MessageCircle size={20} />}
          active={!mapOpen}
          onClick={() => setMapOpen(false)}
        />
        <IconButton
          label="地图"
          tipSide="right"
          size="lg"
          icon={<Map size={20} />}
          active={mapOpen}
          onClick={() => setMapOpen(true)}
        />
      </div>

      <div className="flex-1" />

      <div className="flex flex-col items-center gap-1">
        {appPassword && (
          <IconButton
            label="锁定 Trove"
            tipSide="right"
            size="lg"
            icon={<Lock size={18} />}
            onClick={() => void lockApp().catch((e) => toast.error("锁定失败", e))}
          />
        )}
        <span className="relative">
          <IconButton
            label={updateReady ? "设置（有新版本）" : "设置"}
            tipSide="right"
            size="lg"
            icon={<Settings size={20} />}
            onClick={() => setSettingsOpen(true, updateReady ? "about" : undefined)}
          />
          {updateReady && <UpdateDot className="absolute right-1.5 top-1.5" />}
        </span>
      </div>

      <ContextMenu open={menu !== null} x={menu?.x ?? 0} y={menu?.y ?? 0} items={menuItems} onClose={() => setMenu(null)} />
    </aside>
  );
}
