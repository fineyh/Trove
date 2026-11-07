import { FileKey2, Settings2 } from "lucide-react";
import { libraryColor, useLibrariesStore } from "../../stores/libraries";
import { useSessionStore } from "../../stores/session";
import type { LibraryInfo } from "../../types";
import { LibraryAvatar } from "./LibraryAvatar";
import { UnlockForm } from "./UnlockForm";

/** Fills the chat area while the current library is an encrypted, locked one. */
export function LibraryLockedView({ lib }: { lib: LibraryInfo }) {
  const unlock = useLibrariesStore((s) => s.unlock);
  const setLibraryDialog = useSessionStore((s) => s.setLibraryDialog);

  return (
    <div className="relative flex h-full flex-1 items-center justify-center overflow-hidden bg-app">
      {/* Soft wash in the library's color, so the locked state still says which library this is. */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.12] blur-3xl"
        style={{ background: libraryColor(lib.color).bg }}
      />
      <div className="relative flex w-full max-w-sm animate-pop-in flex-col items-center gap-5 px-6">
        <LibraryAvatar name={lib.name} icon={lib.icon} color={lib.color} size={72} locked />
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="text-lg font-semibold">{lib.name}</div>
          <div className="text-sm text-app-muted">这个库已加密，解锁后才能看到里面的内容。</div>
        </div>

        <UnlockForm
          key={lib.id}
          allowRecovery={lib.hasRecovery}
          passwordPlaceholder="库密码"
          onUnlock={(s, m) => unlock(lib.id, s, m)}
        />

        {lib.keyfilePath && (
          <div className="flex w-full items-start gap-2.5 rounded-xl border border-app-border bg-app-panel/70 px-3 py-2.5 text-xs leading-5 text-app-muted">
            <FileKey2 size={14} className="mt-0.5 shrink-0" />
            <span>
              也可以连接钥匙文件所在的盘，检测到后会自动解锁：
              <span className="mt-0.5 block break-all font-mono text-[11px] text-app-fg/70">
                {lib.keyfilePath}
              </span>
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => setLibraryDialog({ mode: "settings", id: lib.id })}
          className="flex items-center gap-1.5 text-xs text-app-muted transition-colors hover:text-app-fg"
        >
          <Settings2 size={13} />
          库设置
        </button>
      </div>
    </div>
  );
}
