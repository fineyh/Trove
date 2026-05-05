import { HardDrive, KeyRound, Lock, RefreshCw, ShieldOff, Trash2, X } from "lucide-react";
import { useEffect } from "react";
import { useSessionStore } from "../../stores/session";
import { useSettingsStore } from "../../stores/settings";
import { useConversationsStore } from "../../stores/conversations";
import { useVaultStore } from "../../stores/vault";
import type { MissingFileStrategy, VolumePayload } from "../../types";
import { cn } from "../../lib/cn";

export function SettingsDialog() {
  const open = useSessionStore((s) => s.settingsOpen);
  const setOpen = useSessionStore((s) => s.setSettingsOpen);

  const settings = useSettingsStore((s) => s.settings);
  const volumes = useSettingsStore((s) => s.volumes);
  const loading = useSettingsStore((s) => s.loading);
  const load = useSettingsStore((s) => s.load);
  const setMissingStrategy = useSettingsStore((s) => s.setMissingStrategy);
  const rescan = useSettingsStore((s) => s.rescan);
  const forget = useSettingsStore((s) => s.forget);
  const refreshConvs = useConversationsStore((s) => s.refresh);
  const vaultStatus = useVaultStore((s) => s.status);
  const openVaultDialog = useVaultStore((s) => s.openDialog);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const handleStrategyChange = async (value: MissingFileStrategy) => {
    await setMissingStrategy(value);
    await refreshConvs();
  };

  const handleRescan = async () => {
    await rescan();
    await refreshConvs();
  };

  const handleForget = async (id: number) => {
    if (!window.confirm("移除该卷的记录会一并清除卷内所有媒体记录，确定？")) {
      return;
    }
    await forget(id);
    await refreshConvs();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col gap-5 overflow-hidden rounded-lg border border-app-border bg-app-panel p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold">设置</div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-7 w-7 items-center justify-center rounded text-app-muted hover:bg-app-subtle"
          >
            <X size={16} />
          </button>
        </div>

        <section className="flex flex-col gap-2">
          <div className="text-sm font-medium">数据库加密</div>
          <div className="text-xs text-app-muted">
            主密码会用 Argon2id 派生密钥并以 SQLCipher 加密整个数据库。
            {vaultStatus.hasMasterPassword
              ? " 当前已启用。"
              : " 当前未启用，数据库为明文。"}
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

        <section className="flex flex-col gap-2">
          <div className="text-sm font-medium">失效文件显示</div>
          <div className="text-xs text-app-muted">
            当媒体所在的卷未挂载，或文件已被外部删除时如何呈现。
          </div>
          <div className="flex gap-2">
            <StrategyOption
              active={settings.missingFileStrategy === "hide"}
              title="隐藏"
              desc="像未存在过一样不显示，重新挂载后自动恢复"
              onClick={() => handleStrategyChange("hide")}
            />
            <StrategyOption
              active={settings.missingFileStrategy === "placeholder"}
              title="灰色占位"
              desc="保留消息位置并显示占位框"
              onClick={() => handleStrategyChange("placeholder")}
            />
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">已识别的卷</div>
              <div className="text-xs text-app-muted">
                包括当前在线和曾经使用过的设备
              </div>
            </div>
            <button
              type="button"
              onClick={handleRescan}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-md border border-app-border px-2.5 py-1 text-xs hover:bg-app-subtle disabled:opacity-50"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              重新扫描
            </button>
          </div>
          <div className="flex-1 overflow-y-auto rounded-md border border-app-border">
            {volumes.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-app-muted">
                {loading ? "加载中..." : "尚无记录"}
              </div>
            ) : (
              <ul className="divide-y divide-app-border">
                {volumes.map((v) => (
                  <VolumeRow
                    key={v.id}
                    volume={v}
                    onForget={() => handleForget(v.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

interface StrategyOptionProps {
  active: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}

function StrategyOption({ active, title, desc, onClick }: StrategyOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col items-start gap-1 rounded-md border p-3 text-left transition",
        active
          ? "border-app-accent bg-app-accent/5"
          : "border-app-border hover:bg-app-subtle",
      )}
    >
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-app-muted">{desc}</span>
    </button>
  );
}

interface VolumeRowProps {
  volume: VolumePayload;
  onForget: () => void;
}

function VolumeRow({ volume, onForget }: VolumeRowProps) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
          volume.online
            ? "bg-emerald-500/10 text-emerald-500"
            : "bg-app-muted/10 text-app-muted",
        )}
      >
        <HardDrive size={16} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 truncate text-sm font-medium">
          {volume.label || volume.platformId}
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
              volume.online
                ? "bg-emerald-500/15 text-emerald-600"
                : "bg-app-muted/15 text-app-muted",
            )}
          >
            {volume.online ? "在线" : "离线"}
          </span>
        </div>
        <div className="truncate text-xs text-app-muted">
          {volume.currentMount ?? volume.lastMount ?? "未知挂载点"} ·{" "}
          {volume.mediaCount} 个媒体
          {volume.brokenCount > 0 && ` · ${volume.brokenCount} 失效`}
        </div>
      </div>
      <button
        type="button"
        onClick={onForget}
        title="忘记此卷"
        className="flex h-7 w-7 items-center justify-center rounded text-app-muted hover:bg-app-subtle hover:text-red-500"
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}
