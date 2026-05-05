import { Lock } from "lucide-react";
import { useState } from "react";
import { useVaultStore } from "../../stores/vault";

export function UnlockScreen() {
  const unlock = useVaultStore((s) => s.unlock);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
      setPassword("");
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "解锁失败";
      setError(message);
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-app-bg">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-app-border bg-app-panel p-8 shadow-2xl"
      >
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-app-accent/10 text-app-accent">
            <Lock size={26} />
          </div>
          <div className="text-lg font-semibold">解锁 Trove</div>
          <div className="text-center text-xs text-app-muted">
            数据库已加密，请输入主密码继续。
            <br />
            忘记密码即数据无法恢复。
          </div>
        </div>

        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="主密码"
          className="rounded-md border border-app-border bg-app-subtle px-3 py-2 text-sm outline-none focus:border-app-accent/60 focus:bg-app-panel"
        />
        {error && <div className="text-xs text-red-500">{error}</div>}

        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="rounded-md bg-app-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "解锁中..." : "解锁"}
        </button>
      </form>
    </div>
  );
}
