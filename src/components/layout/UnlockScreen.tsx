import { ShieldCheck } from "lucide-react";
import { useSecurityStore } from "../../stores/security";
import { UnlockForm } from "../library/UnlockForm";

/** Shown at start (and after locking) when a startup password is set. */
export function UnlockScreen() {
  const unlock = useSecurityStore((s) => s.unlock);
  const hasRecovery = useSecurityStore((s) => s.status?.appRecovery === true);

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-app">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-app-accent/10 blur-3xl" />
      <div className="relative flex w-full max-w-sm animate-pop-in flex-col items-center gap-6 px-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-app-accent to-indigo-600 text-white shadow-lg shadow-app-accent/25">
          <ShieldCheck size={30} strokeWidth={1.75} />
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <div className="text-xl font-semibold tracking-tight">Trove 已锁定</div>
          <div className="text-sm text-app-muted">输入启动密码继续</div>
        </div>
        <UnlockForm
          allowRecovery={hasRecovery}
          passwordPlaceholder="启动密码"
          onUnlock={(secret, method) => unlock(secret, method)}
        />
      </div>
    </div>
  );
}
