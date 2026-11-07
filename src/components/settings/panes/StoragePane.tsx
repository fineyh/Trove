import { Copy, FolderOpen, HardDrive, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useConversationsStore } from "../../../stores/conversations";
import { useSettingsStore } from "../../../stores/settings";
import { currentLib, useCurrentLibrary } from "../../../stores/libraries";
import { useThumbsStore } from "../../../stores/thumbs";
import type { RepairScope, VolumePayload, VolumeStat } from "../../../types";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Button, IconButton } from "../../ui/Button";
import { Select } from "../../ui/Select";
import * as ipc from "../../../ipc/client";
import { cn } from "../../../lib/cn";
import { formatBytes } from "../../../lib/media";
import { toast } from "../../../stores/toast";
import { Group, Page, Row, Stats } from "../SettingsKit";
import { BrokenManagerDialog } from "./BrokenManagerDialog";

const SCOPE_OPTIONS: { value: RepairScope; label: string }[] = [
  { value: "lastFolderOnly", label: "原文件夹" },
  { value: "lastFolderRecursive", label: "原文件夹及子文件夹" },
  { value: "allMountedVolumes", label: "所有磁盘" },
];

export function StoragePane() {
  const volumes = useSettingsStore((s) => s.volumes);
  const stats = useSettingsStore((s) => s.stats);
  const loading = useSettingsStore((s) => s.loading);
  const rescan = useSettingsStore((s) => s.rescan);
  const forget = useSettingsStore((s) => s.forget);
  const repairScope = useSettingsStore((s) => s.settings.repairDefaultScope);
  const save = useSettingsStore((s) => s.save);
  const refreshConvs = useConversationsStore((s) => s.refresh);
  const lib = useCurrentLibrary();
  const thumbsLeft = useThumbsStore((s) => (lib ? s.remaining[lib.id] : undefined));

  const [pendingForget, setPendingForget] = useState<VolumePayload | null>(null);
  const [forgetBusy, setForgetBusy] = useState(false);
  const [missing, setMissing] = useState<number | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);

  const refreshMissing = useCallback(async () => {
    try {
      const groups = await ipc.listBrokenPointers(currentLib());
      setMissing(groups.reduce((n, g) => n + g.items.length, 0));
    } catch (e) {
      toast.error("读取缺失的文件失败", e);
    }
  }, []);

  useEffect(() => {
    void refreshMissing();
  }, [refreshMissing]);

  const sizeByVolume = new Map<number, number>((stats?.byVolume ?? []).map((v: VolumeStat) => [v.volumeId, v.sizeBytes]));

  const handleRescan = async () => {
    try {
      await rescan();
      await refreshConvs();
    } catch (e) {
      toast.error("扫描磁盘失败", e);
    }
  };

  const handleForgetConfirm = async () => {
    if (!pendingForget) return;
    setForgetBusy(true);
    try {
      await forget(pendingForget.id);
      await refreshConvs();
      setPendingForget(null);
    } catch (e) {
      toast.error("移除磁盘失败", e);
    } finally {
      setForgetBusy(false);
    }
  };

  const copyPath = async () => {
    if (!stats?.dataDir) return;
    try {
      await navigator.clipboard.writeText(stats.dataDir);
      toast.success("已复制");
    } catch (e) {
      toast.error("复制失败", e);
    }
  };

  return (
    <Page title="存储">
      <Group title={lib ? `当前库 · ${lib.name}` : "当前库"}>
        <Stats
          items={[
            { label: "文件", value: stats ? stats.totalMedia.toLocaleString() : "—" },
            { label: "大小", value: stats ? formatBytes(stats.totalBytes) : "—" },
            { label: "磁盘", value: volumes.length },
          ]}
        />
        <Row label="缩略图">
          {thumbsLeft ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={13} className="animate-spin" />
              正在生成，剩余 {thumbsLeft.toLocaleString()}
            </span>
          ) : (
            "已完成"
          )}
        </Row>
        <Row label="缺失的文件" onClick={missing ? () => setManagerOpen(true) : undefined}>
          {missing === null ? "—" : missing === 0 ? "无" : <span className="font-medium text-app-danger">{missing}</span>}
        </Row>
        <Row label="自动匹配范围" description="重新链接缺失的文件时，在哪里查找">
          <Select
            label="自动匹配范围"
            value={repairScope}
            options={SCOPE_OPTIONS}
            onChange={(v) => void save("repairDefaultScope", v).catch((e) => toast.error("设置没有保存", e))}
          />
        </Row>
      </Group>

      <Group
        title="磁盘"
        action={
          <Button size="sm" variant="ghost" icon={<RefreshCw size={12} className={loading ? "animate-spin" : ""} />} onClick={handleRescan} disabled={loading} className="-mr-2">
            重新扫描
          </Button>
        }
      >
        {volumes.length === 0 ? (
          <Row label={<span className="text-app-muted">{loading ? "正在读取…" : "没有记录"}</span>} />
        ) : (
          volumes.map((v) => (
            <VolumeRow key={v.id} volume={v} sizeBytes={sizeByVolume.get(v.id) ?? 0} onForget={() => setPendingForget(v)} />
          ))
        )}
      </Group>

      <Group title="数据位置">
        <Row label={<span className="selectable block truncate font-mono text-xs">{stats?.dataDir ?? "—"}</span>}>
          <IconButton label="复制路径" size="sm" icon={<Copy size={14} />} onClick={copyPath} disabled={!stats?.dataDir} />
          <IconButton
            label="在资源管理器中打开"
            size="sm"
            icon={<FolderOpen size={14} />}
            disabled={!stats?.dataDir}
            onClick={() => stats?.dataDir && void ipc.openPath(stats.dataDir).catch((e) => toast.error("打开失败", e))}
          />
        </Row>
      </Group>

      <ConfirmDialog
        open={pendingForget !== null}
        variant="danger"
        title="移除磁盘"
        message={pendingForget ? `「${pendingForget.label || pendingForget.platformId}」上的媒体记录会一并移除，磁盘上的文件不受影响。` : ""}
        confirmText="移除"
        busy={forgetBusy}
        onConfirm={handleForgetConfirm}
        onCancel={() => setPendingForget(null)}
      />

      {managerOpen && (
        <BrokenManagerDialog
          scope={repairScope}
          onClose={() => {
            setManagerOpen(false);
            void refreshMissing();
          }}
        />
      )}
    </Page>
  );
}

function VolumeRow({ volume, sizeBytes, onForget }: { volume: VolumePayload; sizeBytes: number; onForget: () => void }) {
  const mount = volume.currentMount ?? volume.lastMount;
  const parts = [
    mount,
    `${volume.mediaCount.toLocaleString()} 个文件`,
    formatBytes(sizeBytes),
    volume.brokenCount > 0 ? `${volume.brokenCount} 个缺失` : null,
  ].filter(Boolean);
  return (
    <div className="group">
      <Row
        leading={
          <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-app-subtle text-app-secondary">
            <HardDrive size={16} />
            <span
              className={cn(
                "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-app-panel",
                volume.online ? "bg-app-success" : "bg-app-muted",
              )}
            />
          </span>
        }
        label={
          <span className="flex items-center gap-2">
            {volume.label || volume.platformId}
            {!volume.online && <span className="text-xs text-app-muted">离线</span>}
          </span>
        }
        description={parts.join(" · ")}
      >
        <IconButton
          label="移除"
          size="sm"
          icon={<Trash2 size={14} />}
          onClick={onForget}
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        />
      </Row>
    </div>
  );
}
