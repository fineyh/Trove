import { Check, Copy, FolderOpen, HardDrive, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useConversationsStore } from "../../../stores/conversations";
import { useSettingsStore } from "../../../stores/settings";
import type { VolumePayload, VolumeStat } from "../../../types";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import * as ipc from "../../../ipc/client";
import { cn } from "../../../lib/cn";

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
}

export function StoragePane() {
  const volumes = useSettingsStore((s) => s.volumes);
  const stats = useSettingsStore((s) => s.stats);
  const loading = useSettingsStore((s) => s.loading);
  const rescan = useSettingsStore((s) => s.rescan);
  const forget = useSettingsStore((s) => s.forget);
  const refreshConvs = useConversationsStore((s) => s.refresh);

  const [pendingForget, setPendingForget] = useState<VolumePayload | null>(null);
  const [forgetBusy, setForgetBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const sizeByVolume = new Map<number, number>(
    (stats?.byVolume ?? []).map((v: VolumeStat) => [v.volumeId, v.sizeBytes]),
  );

  const handleRescan = async () => {
    await rescan();
    await refreshConvs();
  };

  const handleForgetConfirm = async () => {
    if (!pendingForget) return;
    setForgetBusy(true);
    try {
      await forget(pendingForget.id);
      await refreshConvs();
      setPendingForget(null);
    } finally {
      setForgetBusy(false);
    }
  };

  const handleCopyPath = async () => {
    if (!stats?.dataDir) return;
    try {
      await navigator.clipboard.writeText(stats.dataDir);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 1500);
    } catch (e) {
      console.error("clipboard.writeText failed", e);
    }
  };

  const handleOpenDir = async () => {
    if (!stats?.dataDir) return;
    try {
      await ipc.openPath(stats.dataDir);
    } catch (e) {
      console.error("open dataDir failed", e);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">存储</h2>

      <section className="flex flex-col gap-2">
        <div className="text-sm font-medium">数据目录</div>
        <div className="text-xs text-app-muted">
          Trove 的数据库、缩略图与配置都保存在此目录。
        </div>
        <div className="mt-1 flex items-center gap-2 rounded-md border border-app-border bg-app-subtle/40 p-2">
          <div className="flex-1 truncate font-mono text-xs" title={stats?.dataDir}>
            {stats?.dataDir ?? "加载中..."}
          </div>
          <button
            type="button"
            onClick={handleCopyPath}
            disabled={!stats?.dataDir}
            title={copied ? "已复制" : "复制路径"}
            className={cn(
              "flex h-7 items-center gap-1 rounded px-1.5 text-xs transition-colors disabled:opacity-40",
              copied
                ? "bg-emerald-500/15 text-emerald-600"
                : "text-app-muted hover:bg-app-subtle hover:text-app-fg",
            )}
          >
            {copied ? (
              <>
                <Check size={13} />
                <span>已复制</span>
              </>
            ) : (
              <Copy size={13} />
            )}
          </button>
          <button
            type="button"
            onClick={handleOpenDir}
            disabled={!stats?.dataDir}
            title="在文件管理器中打开"
            className="flex h-7 w-7 items-center justify-center rounded text-app-muted hover:bg-app-subtle hover:text-app-fg disabled:opacity-40"
          >
            <FolderOpen size={13} />
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="text-sm font-medium">媒体库</div>
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="文件数" value={stats ? stats.totalMedia.toLocaleString() : "—"} />
          <StatCard label="占用空间" value={stats ? formatBytes(stats.totalBytes) : "—"} />
          <StatCard label="卷数量" value={volumes.length.toString()} />
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
        <div className="overflow-y-auto rounded-md border border-app-border">
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
                  sizeBytes={sizeByVolume.get(v.id) ?? 0}
                  onForget={() => setPendingForget(v)}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={pendingForget !== null}
        variant="danger"
        title="忘记此卷"
        message={
          pendingForget
            ? `将清除卷「${pendingForget.label || pendingForget.platformId}」的所有媒体记录，无法恢复。确定？`
            : ""
        }
        confirmText="忘记"
        busy={forgetBusy}
        onConfirm={handleForgetConfirm}
        onCancel={() => setPendingForget(null)}
      />
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-app-border bg-app-subtle/30 p-3">
      <div className="text-xs text-app-muted">{label}</div>
      <div className="truncate text-base font-semibold">{value}</div>
    </div>
  );
}

interface VolumeRowProps {
  volume: VolumePayload;
  sizeBytes: number;
  onForget: () => void;
}

function VolumeRow({ volume, sizeBytes, onForget }: VolumeRowProps) {
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
          {volume.mediaCount} 个媒体 · {formatBytes(sizeBytes)}
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
