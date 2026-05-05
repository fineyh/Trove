import { Lock, X } from "lucide-react";
import { useState } from "react";
import { useVaultStore } from "../../stores/vault";
import { useConversationsStore } from "../../stores/conversations";
import { useMessagesStore } from "../../stores/messages";
import * as ipc from "../../ipc/client";

export function ConvUnlockDialog() {
  const dialog = useVaultStore((s) => s.dialog);
  const convId = useVaultStore((s) => s.pendingConvId);
  const close = useVaultStore((s) => s.closeDialog);
  const refreshConvs = useConversationsStore((s) => s.refresh);
  const reloadMessages = useMessagesStore((s) => s.load);

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (dialog !== "unlock-conv" || convId === null) return null;

  const handleClose = () => {
    setPassword("");
    setError(null);
    setBusy(false);
    close();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      await ipc.unlockConversation(convId, password);
      await refreshConvs();
      await reloadMessages(convId);
      handleClose();
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err);
      setError(m);
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-app-border bg-app-panel p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-base font-semibold">
            <Lock size={16} />
            解锁会话
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded text-app-muted hover:bg-app-subtle"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-app-muted">
          这是加密会话，请输入会话密码以查看消息。30 分钟无操作会自动重新上锁。
        </p>

        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="会话密码"
          className="rounded-md border border-app-border bg-app-subtle px-3 py-2 text-sm outline-none focus:border-app-accent/60 focus:bg-app-panel"
        />
        {error && <div className="text-xs text-red-500">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-app-border px-3 py-1.5 text-sm hover:bg-app-subtle"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy || password.length === 0}
            className="rounded-md bg-app-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "解锁中..." : "解锁"}
          </button>
        </div>
      </form>
    </div>
  );
}
