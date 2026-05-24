import { LogIn, LogOut, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuthStore } from "../../../stores/auth";
import { useVaultStore } from "../../../stores/vault";

export function AccountPane() {
  const status = useAuthStore((s) => s.status);
  const ready = useAuthStore((s) => s.ready);
  const busy = useAuthStore((s) => s.busy);
  const refresh = useAuthStore((s) => s.refresh);
  const login = useAuthStore((s) => s.login);
  const doLogout = useAuthStore((s) => s.logout);
  const vaultStatus = useVaultStore((s) => s.status);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const vaultLocked =
    vaultStatus.hasMasterPassword && !vaultStatus.unlocked;

  const handleLogin = async () => {
    setError(null);
    try {
      await login();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleLogout = async () => {
    setError(null);
    try {
      await doLogout();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">账号</h2>

      <section className="flex flex-col gap-3">
        <div className="text-sm font-medium">Google 身份</div>
        <div className="text-xs text-app-muted">
          仅用于在本地显示头像与邮箱，不会上传任何媒体或元数据。
          refresh_token 在已设置主密码时会用 AES-GCM 加密后写入数据库。
        </div>

        {!ready ? (
          <div className="rounded-md border border-app-border bg-app-subtle/30 px-3 py-6 text-center text-xs text-app-muted">
            加载中...
          </div>
        ) : status.hasIdentity ? (
          <div className="flex items-center gap-3 rounded-md border border-app-border bg-app-subtle/30 p-3">
            {status.pictureUrl ? (
              <img
                src={status.pictureUrl}
                alt=""
                className="h-10 w-10 rounded-full"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-app-accent/15 text-app-accent">
                <User size={18} />
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="truncate text-sm font-medium">
                {status.displayName ?? status.email ?? "Google 用户"}
              </div>
              {status.email && (
                <div className="truncate text-xs text-app-muted">
                  {status.email}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md border border-app-border px-2.5 py-1.5 text-xs hover:bg-app-subtle disabled:opacity-40"
            >
              <LogOut size={12} />
              {busy ? "处理中..." : "登出"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-md border border-dashed border-app-border bg-app-subtle/30 p-4">
            <div className="flex items-center gap-2 text-sm text-app-muted">
              <User size={14} />
              尚未登录
            </div>
            <button
              type="button"
              onClick={handleLogin}
              disabled={busy || vaultLocked}
              className="mt-1 flex items-center justify-center gap-1.5 self-start rounded-md bg-app-accent px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-40"
            >
              <LogIn size={12} />
              {busy ? "等待浏览器授权..." : "用 Google 登录"}
            </button>
            {vaultLocked && (
              <div className="text-xs text-app-muted">
                请先在「安全」中解锁主密码后再登录。
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
            {error}
          </div>
        )}
      </section>
    </div>
  );
}
