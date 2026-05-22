import { KeyRound, Lock, ShieldOff } from "lucide-react";
import { useVaultStore } from "../../../stores/vault";

export function SecurityPane() {
  const vaultStatus = useVaultStore((s) => s.status);
  const openVaultDialog = useVaultStore((s) => s.openDialog);

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">安全</h2>

      <section className="flex flex-col gap-3">
        <div>
          <div className="text-sm font-medium">数据库加密</div>
          <div className="mt-1 text-xs text-app-muted">
            主密码会用 Argon2id 派生密钥并以 SQLCipher 加密整个数据库。
            {vaultStatus.hasMasterPassword
              ? " 当前已启用。"
              : " 当前未启用，数据库为明文。"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!vaultStatus.hasMasterPassword ? (
            <button
              type="button"
              onClick={() => openVaultDialog("set")}
              className="flex items-center gap-1.5 rounded-md bg-app-accent px-2.5 py-1.5 text-xs text-white hover:opacity-90"
            >
              <Lock size={12} />
              设置主密码
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => openVaultDialog("change")}
                className="flex items-center gap-1.5 rounded-md border border-app-border px-2.5 py-1.5 text-xs hover:bg-app-subtle"
              >
                <KeyRound size={12} />
                修改密码
              </button>
              <button
                type="button"
                onClick={() => openVaultDialog("remove")}
                className="flex items-center gap-1.5 rounded-md border border-app-border px-2.5 py-1.5 text-xs text-red-500 hover:bg-red-500/10"
              >
                <ShieldOff size={12} />
                移除加密
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
