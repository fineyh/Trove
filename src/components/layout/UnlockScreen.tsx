import { useSecurityStore } from "../../stores/security";
import { UnlockForm } from "../library/UnlockForm";
import { DragStrip } from "../ui/WindowControls";
import appIcon from "../../../src-tauri/icons/128x128@2x.png";

/** Shown at start (and after locking) when the app lock is on. */
export function UnlockScreen() {
  const unlock = useSecurityStore((s) => s.unlock);
  const hasRecovery = useSecurityStore((s) => s.status?.appRecovery === true);

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-app">
      <DragStrip />
      <div className="flex w-full max-w-[320px] animate-pop-in flex-col items-center gap-6 px-6">
        <img src={appIcon} alt="" className="h-16 w-16" draggable={false} />
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="text-lg font-semibold">Trove 已锁定</div>
          <div className="text-sm text-app-muted">输入应用密码</div>
        </div>
        <UnlockForm allowRecovery={hasRecovery} passwordPlaceholder="应用密码" onUnlock={(secret, method) => unlock(secret, method)} />
      </div>
    </div>
  );
}
