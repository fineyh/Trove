import { useLibrariesStore } from "../../stores/libraries";
import { useSessionStore } from "../../stores/session";
import type { LibraryInfo } from "../../types";
import { Button } from "../ui/Button";
import { DragStrip } from "../ui/WindowControls";
import { LibraryAvatar } from "./LibraryAvatar";
import { UnlockForm } from "./UnlockForm";

/** Fills the window right of the rail while the current library is locked. */
export function LibraryLockedView({ lib }: { lib: LibraryInfo }) {
  const unlock = useLibrariesStore((s) => s.unlock);
  const setLibraryDialog = useSessionStore((s) => s.setLibraryDialog);

  return (
    <div className="relative flex h-full flex-1 items-center justify-center border-l border-app-border bg-app-panel">
      <DragStrip />
      <div className="flex w-full max-w-[320px] animate-pop-in flex-col items-center gap-6 px-6">
        <LibraryAvatar name={lib.name} icon={lib.icon} color={lib.color} size={64} locked />
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="text-lg font-semibold">{lib.name}</div>
          <div className="text-sm text-app-muted">{lib.keyfilePath ? "输入密码，或连接存放密钥文件的磁盘" : "输入密码解锁"}</div>
        </div>

        <UnlockForm key={lib.id} allowRecovery={lib.hasRecovery} passwordPlaceholder="库密码" onUnlock={(s, m) => unlock(lib.id, s, m)} />

        <Button size="sm" variant="ghost" className="text-app-secondary" onClick={() => setLibraryDialog({ mode: "settings", id: lib.id })}>
          库设置
        </Button>
      </div>
    </div>
  );
}
