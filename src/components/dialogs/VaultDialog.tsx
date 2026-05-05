import { Lock, X } from "lucide-react";
import { useState } from "react";
import { useVaultStore } from "../../stores/vault";

type Mode = "set" | "change" | "remove";

const COPY: Record<Mode, { title: string; submit: string; intro: string }> = {
  set: {
    title: "设置主密码",
    submit: "启用加密",
    intro: "首次设置后整个数据库将以 SQLCipher 加密。忘记密码即数据无法恢复。",
  },
  change: {
    title: "修改主密码",
    submit: "保存",
    intro: "修改后旧密码立即失效，请妥善保管。",
  },
  remove: {
    title: "移除主密码",
    submit: "解除加密",
    intro: "数据库将解密为明文，谁拿到文件都能直接读。",
  },
};

export function VaultDialog() {
  const dialog = useVaultStore((s) => s.dialog);
  const close = useVaultStore((s) => s.closeDialog);
  const setPassword = useVaultStore((s) => s.setPassword);
  const changePassword = useVaultStore((s) => s.changePassword);
  const removePassword = useVaultStore((s) => s.removePassword);

  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (dialog !== "set" && dialog !== "change" && dialog !== "remove") return null;
  const mode = dialog as Mode;
  const copy = COPY[mode];

  const reset = () => {
    setOldPwd("");
    setNewPwd("");
    setConfirmPwd("");
    setError(null);
    setBusy(false);
  };

  const handleClose = () => {
    reset();
    close();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "set" || mode === "change") {
      if (newPwd.length < 6) {
        setError("密码至少 6 位");
        return;
      }
      if (newPwd !== confirmPwd) {
        setError("两次输入的密码不一致");
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === "set") {
        await setPassword(newPwd);
      } else if (mode === "change") {
        await changePassword(oldPwd, newPwd);
      } else {
        await removePassword(oldPwd);
      }
      reset();
      close();
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
            {copy.title}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded text-app-muted hover:bg-app-subtle"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-app-muted">{copy.intro}</p>

        {(mode === "change" || mode === "remove") && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-app-muted">当前密码</label>
            <input
              type="password"
              autoFocus
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
              className="rounded-md border border-app-border bg-app-subtle px-3 py-2 text-sm outline-none focus:border-app-accent/60 focus:bg-app-panel"
            />
          </div>
        )}

        {(mode === "set" || mode === "change") && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-app-muted">新密码</label>
              <input
                type="password"
                autoFocus={mode === "set"}
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                className="rounded-md border border-app-border bg-app-subtle px-3 py-2 text-sm outline-none focus:border-app-accent/60 focus:bg-app-panel"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-app-muted">再次输入</label>
              <input
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                className="rounded-md border border-app-border bg-app-subtle px-3 py-2 text-sm outline-none focus:border-app-accent/60 focus:bg-app-panel"
              />
            </div>
          </>
        )}

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
            disabled={busy}
            className="rounded-md bg-app-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "处理中..." : copy.submit}
          </button>
        </div>
      </form>
    </div>
  );
}
