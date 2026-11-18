import { HardDrive, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import * as ipc from "../../ipc/client";
import { cn } from "../../lib/cn";
import { formatBytes } from "../../lib/media";
import { useConversationsStore } from "../../stores/conversations";
import { stillOn } from "../../stores/libraries";
import { useMessagesStore } from "../../stores/messages";
import { useSessionStore } from "../../stores/session";
import { useThumbsStore } from "../../stores/thumbs";
import { toast } from "../../stores/toast";
import type { LibraryInfo, StorageStats, VolumePayload } from "../../types";
import { BrokenManagerDialog } from "../settings/panes/BrokenManagerDialog";
import { Group, Row, Stats } from "../settings/SettingsKit";
import { Button, IconButton } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";

/** What one space holds (ADR-055). Reads by id: the space need not be the current one. */
export function LibraryDataTab({ lib }: { lib: LibraryInfo }) {
  const id = lib.id;
  const thumbsLeft = useThumbsStore((s) => s.remaining[id]);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [volumes, setVolumes] = useState<VolumePayload[] | null>(null);
  const [missing, setMissing] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [missingOpen, setMissingOpen] = useState(false);
  const [pendingForget, setPendingForget] = useState<VolumePayload | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, v, groups] = await Promise.all([ipc.getStorageStats(id), ipc.listVolumes(id), ipc.listBrokenPointers(id)]);
      setStats(s);
      setVolumes(v);
      setMissing(groups.reduce((n, g) => n + g.items.length, 0));
    } catch (e) {
      toast.error("无法读取空间数据", e);
    }
  }, [id]);

  useEffect(() => {
    void load();
    let un: (() => void) | undefined;
    let gone = false;
    void ipc.onVolumesChanged((lib) => lib === id && void load()).then((fn) => (gone ? fn() : (un = fn)));
    return () => {
      gone = true;
      un?.();
    };
  }, [id, load]);

  // What's on screen comes from the current space only.
  const refreshScreen = () => {
    if (stillOn(id)) void useConversationsStore.getState().refresh();
  };

  const rescan = async () => {
    setScanning(true);
    try {
      await ipc.rescanVolumes(id);
      await load();
      refreshScreen();
    } catch (e) {
      toast.error("无法扫描磁盘", e);
    } finally {
      setScanning(false);
    }
  };

  const forget = async () => {
    if (!pendingForget) return;
    setBusy(true);
    try {
      await ipc.forgetVolume(id, pendingForget.id);
      setPendingForget(null);
      await load();
      refreshScreen();
    } catch (e) {
      toast.error("无法移除磁盘", e);
    } finally {
      setBusy(false);
    }
  };

  const clearViews = async () => {
    setBusy(true);
    try {
      await ipc.statsClear(id);
      // Play counts went back to zero; show that.
      const active = useSessionStore.getState().activeConversationId;
      if (stillOn(id) && active !== null) void useMessagesStore.getState().refresh(active);
      setConfirmClear(false);
      toast.success("已清除观看记录");
    } catch (e) {
      toast.error("无法清除观看记录", e);
    } finally {
      setBusy(false);
    }
  };

  const sizeByVolume = new Map((stats?.byVolume ?? []).map((v) => [v.volumeId, v.sizeBytes]));

  return (
    <div className="flex flex-col gap-5">
      <Group>
        <Stats
          items={[
            { label: "文件", value: stats ? stats.totalMedia.toLocaleString() : "—" },
            { label: "大小", value: stats ? formatBytes(stats.totalBytes) : "—" },
            { label: "磁盘", value: volumes ? volumes.length : "—" },
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
        <Row label="缺失的文件" onClick={missing ? () => setMissingOpen(true) : undefined}>
          {missing === null ? "—" : missing === 0 ? "无" : <span className="font-medium text-app-danger">{missing.toLocaleString()}</span>}
        </Row>
      </Group>

      <Group
        title="磁盘"
        action={
          <Button size="sm" variant="ghost" icon={<RefreshCw size={12} className={scanning ? "animate-spin" : ""} />} onClick={rescan} disabled={scanning} className="-mr-2">
            重新扫描
          </Button>
        }
      >
        {volumes === null || volumes.length === 0 ? (
          <Row label={<span className="text-app-muted">{volumes === null ? "正在读取…" : "无"}</span>} />
        ) : (
          volumes.map((v) => <VolumeRow key={v.id} volume={v} sizeBytes={sizeByVolume.get(v.id) ?? 0} onForget={() => setPendingForget(v)} />)
        )}
      </Group>

      <Group>
        <Row label="观看记录">
          <Button size="sm" variant="danger-secondary" onClick={() => setConfirmClear(true)}>
            清除…
          </Button>
        </Row>
      </Group>

      <ConfirmDialog
        open={pendingForget !== null}
        variant="danger"
        title="移除磁盘"
        message={pendingForget ? `将移除「${pendingForget.label || pendingForget.platformId}」上全部文件的记录，磁盘上的文件不受影响。` : ""}
        confirmText="移除"
        busy={busy}
        onConfirm={() => void forget()}
        onCancel={() => setPendingForget(null)}
      />

      <ConfirmDialog
        open={confirmClear}
        variant="danger"
        title="清除观看记录"
        message={`将删除「${lib.name}」的观看时长和播放次数。此操作无法撤销。`}
        confirmText="清除"
        busy={busy}
        onConfirm={() => void clearViews()}
        onCancel={() => setConfirmClear(false)}
      />

      {missingOpen && (
        <BrokenManagerDialog
          lib={id}
          onClose={() => {
            setMissingOpen(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function VolumeRow({ volume, sizeBytes, onForget }: { volume: VolumePayload; sizeBytes: number; onForget: () => void }) {
  const mount = volume.currentMount ?? volume.lastMount;
  const parts = [
    mount,
    `${volume.mediaCount.toLocaleString()} 个文件`,
    formatBytes(sizeBytes),
    volume.brokenCount > 0 ? `${volume.brokenCount.toLocaleString()} 个缺失` : null,
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
