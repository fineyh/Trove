import {
  ChevronDown,
  ChevronRight,
  FileImage,
  FileVideo,
  FolderOpen,
  Loader2,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import * as ipc from "../../../ipc/client";
import { useConversationsStore } from "../../../stores/conversations";
import { currentLib, useLibrariesStore } from "../../../stores/libraries";
import type {
  BrokenGroup,
  BrokenItem,
  RepairOutcome,
  RepairScope,
} from "../../../types";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Button, IconButton } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { useEscapeLayer } from "../../ui/Modal";
import { Notice } from "../../ui/Notice";
import { createPortal } from "react-dom";
import { cn } from "../../../lib/cn";
import { errText } from "../../../lib/errors";

interface BrokenManagerDialogProps {
  scope: RepairScope;
  onClose: () => void;
}

type RowTone = "error" | "warn";

interface RowHint {
  tone: RowTone;
  text: string;
}

export function BrokenManagerDialog({ scope, onClose }: BrokenManagerDialogProps) {
  const refreshConvs = useConversationsStore((s) => s.refresh);

  const [groups, setGroups] = useState<BrokenGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [processingMedia, setProcessingMedia] = useState<Set<number>>(() => new Set());
  const [rowHints, setRowHints] = useState<Map<number, RowHint>>(() => new Map());
  const [batchProgress, setBatchProgress] = useState<Map<number, { done: number; total: number }>>(
    () => new Map(),
  );
  const [pendingDelete, setPendingDelete] = useState<{
    convName: string;
    item: BrokenItem;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const cancelAllRef = useRef(false);

  const loadList = useCallback(async () => {
    try {
      const list = await ipc.listBrokenPointers(currentLib());
      setGroups(list);
      setLoadError(null);
    } catch (e) {
      console.error("list_broken_pointers failed", e);
      setLoadError(errText(e));
      setGroups([]);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEscapeLayer(pendingDelete === null, onClose);

  const totalCount = useMemo(
    () => (groups ?? []).reduce((acc, g) => acc + g.items.length, 0),
    [groups],
  );

  const toggleGroup = (convId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(convId)) next.delete(convId);
      else next.add(convId);
      return next;
    });
  };

  const setHint = (messageId: number, hint: RowHint | null) => {
    setRowHints((prev) => {
      const next = new Map(prev);
      if (hint === null) next.delete(messageId);
      else next.set(messageId, hint);
      return next;
    });
  };

  const applyRepairOutcome = (
    mediaId: number,
    outcome: RepairOutcome,
    sourceMessageId: number,
  ) => {
    if (outcome.status === "repaired") {
      // Remove every row referring to this media across all groups.
      setGroups((prev) => {
        if (!prev) return prev;
        const next = prev
          .map((g) => ({
            ...g,
            items: g.items.filter((it) => it.mediaId !== mediaId),
          }))
          .filter((g) => g.items.length > 0);
        return next;
      });
      return;
    }
    if (outcome.status === "mismatch") {
      // Only the source row reflects the mismatch — same media on another row
      // might still match if user picks a different file.
      setHint(sourceMessageId, { tone: "error", text: outcome.reason });
      return;
    }
    // notFound / ambiguous → fanout to all rows sharing this media.
    const text =
      outcome.status === "notFound"
        ? "未找到匹配文件，请用「手动选」指定路径"
        : `找到 ${outcome.candidates.length} 个候选文件，请用「手动选」指定`;
    const tone: RowTone = outcome.status === "notFound" ? "error" : "warn";
    setRowHints((prev) => {
      const next = new Map(prev);
      const allItems = (groups ?? []).flatMap((g) => g.items);
      for (const it of allItems) {
        if (it.mediaId === mediaId) {
          next.set(it.messageId, { tone, text });
        }
      }
      return next;
    });
  };

  const runRepair = async (
    mediaId: number,
    sourceMessageId: number,
    explicitPath?: string,
  ) => {
    setProcessingMedia((prev) => {
      const next = new Set(prev);
      next.add(mediaId);
      return next;
    });
    setHint(sourceMessageId, null);
    try {
      const outcome = await ipc.repairMedia(currentLib(), { mediaId, scope, explicitPath });
      applyRepairOutcome(mediaId, outcome, sourceMessageId);
      if (outcome.status === "repaired") {
        // Conversation messages should refresh too (preview, etc.)
        void refreshConvs();
      }
    } catch (e) {
      console.error("repair_media failed", e);
      setHint(sourceMessageId, { tone: "error", text: `重新链接失败：${errText(e)}` });
    } finally {
      setProcessingMedia((prev) => {
        const next = new Set(prev);
        next.delete(mediaId);
        return next;
      });
    }
  };

  const handleAuto = (item: BrokenItem) => {
    void runRepair(item.mediaId, item.messageId);
  };

  const handleManual = async (item: BrokenItem) => {
    try {
      const picked = await openFileDialog({ multiple: false, directory: false });
      if (!picked || typeof picked !== "string") return;
      await runRepair(item.mediaId, item.messageId, picked);
    } catch (e) {
      console.error("open dialog failed", e);
      setHint(item.messageId, { tone: "error", text: `打开文件选择器失败: ${errText(e)}` });
    }
  };

  const handleAutoAll = async (group: BrokenGroup) => {
    if (group.items.length === 0) return;
    // Dedup by media_id — one repair call covers all rows sharing the media.
    const uniqueMedia: Array<{ mediaId: number; sourceMessageId: number }> = [];
    const seen = new Set<number>();
    for (const it of group.items) {
      if (seen.has(it.mediaId)) continue;
      seen.add(it.mediaId);
      uniqueMedia.push({ mediaId: it.mediaId, sourceMessageId: it.messageId });
    }
    cancelAllRef.current = false;
    setBatchProgress((prev) => {
      const next = new Map(prev);
      next.set(group.convId, { done: 0, total: uniqueMedia.length });
      return next;
    });
    for (let i = 0; i < uniqueMedia.length; i++) {
      if (cancelAllRef.current) break;
      const { mediaId, sourceMessageId } = uniqueMedia[i];
      await runRepair(mediaId, sourceMessageId);
      setBatchProgress((prev) => {
        const next = new Map(prev);
        next.set(group.convId, { done: i + 1, total: uniqueMedia.length });
        return next;
      });
    }
    setBatchProgress((prev) => {
      const next = new Map(prev);
      next.delete(group.convId);
      return next;
    });
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    try {
      await ipc.deleteMessage(currentLib(), pendingDelete.item.messageId);
      // Reload list — backend may have cascaded media + broken_pointers cleanup.
      await loadList();
      void refreshConvs();
      setPendingDelete(null);
    } catch (e) {
      console.error("delete_message failed", e);
      setHint(pendingDelete.item.messageId, {
        tone: "error",
        text: `删除失败: ${errText(e)}`,
      });
    } finally {
      setDeleteBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/30 p-6 dark:bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[min(640px,85vh)] w-full max-w-[680px] animate-pop-in flex-col overflow-hidden rounded-2xl bg-app-panel shadow-xl ring-1 ring-black/5 dark:ring-white/10"
      >
        <div className="flex items-center gap-3 px-5 pb-3 pt-4">
          <div className="flex flex-1 flex-col">
            <span className="text-base font-semibold">缺失的文件</span>
            <span className="text-xs text-app-muted">
              {groups === null ? "正在读取…" : `${totalCount} 个 · 自动匹配或手动指定新位置`}
            </span>
          </div>
          <IconButton label="关闭" noTip size="sm" icon={<X size={16} />} onClick={onClose} className="-mr-2" />
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {loadError && <Notice tone="danger">{loadError}</Notice>}
          {groups === null ? (
            <div className="flex justify-center py-12 text-app-muted">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : groups.length === 0 ? (
            <EmptyState className="py-16" title="没有缺失的文件" />
          ) : (
            <ul className="flex flex-col gap-3">
              {groups.map((g) => (
                <GroupSection
                  key={g.convId}
                  group={g}
                  expanded={expanded.has(g.convId)}
                  onToggle={() => toggleGroup(g.convId)}
                  processingMedia={processingMedia}
                  batchProgress={batchProgress.get(g.convId)}
                  rowHints={rowHints}
                  onAutoAll={() => void handleAutoAll(g)}
                  onAuto={handleAuto}
                  onManual={(it) => void handleManual(it)}
                  onDelete={(it) => setPendingDelete({ convName: g.convName, item: it })}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        variant="danger"
        title="删除消息"
        message={pendingDelete ? `从「${pendingDelete.convName}」中删除这条消息。` : ""}
        confirmText="删除"
        busy={deleteBusy}
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>,
    document.body,
  );
}

interface GroupSectionProps {
  group: BrokenGroup;
  expanded: boolean;
  onToggle: () => void;
  processingMedia: Set<number>;
  batchProgress: { done: number; total: number } | undefined;
  rowHints: Map<number, RowHint>;
  onAutoAll: () => void;
  onAuto: (item: BrokenItem) => void;
  onManual: (item: BrokenItem) => void;
  onDelete: (item: BrokenItem) => void;
}

function GroupSection({
  group,
  expanded,
  onToggle,
  processingMedia,
  batchProgress,
  rowHints,
  onAutoAll,
  onAuto,
  onManual,
  onDelete,
}: GroupSectionProps) {
  const batching = batchProgress !== undefined;
  return (
    <li className="overflow-hidden rounded-xl border border-app-border">
      <div className="flex h-11 items-center gap-2 pl-2 pr-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left"
        >
          {expanded ? <ChevronDown size={15} className="shrink-0 text-app-muted" /> : <ChevronRight size={15} className="shrink-0 text-app-muted" />}
          <span className="truncate text-sm font-medium">{group.convName}</span>
          <span className="shrink-0 text-xs text-app-muted">{group.items.length}</span>
        </button>
        {batching && (
          <span className="text-xs text-app-muted">
            {batchProgress!.done} / {batchProgress!.total}
          </span>
        )}
        <Button size="sm" variant="ghost" icon={<Wand2 size={13} />} onClick={onAutoAll} disabled={batching}>
          全部自动匹配
        </Button>
      </div>
      {expanded && (
        <ul className="divide-y divide-app-border border-t border-app-border">
          {group.items.map((it) => (
            <BrokenRow
              key={it.messageId}
              item={it}
              busy={processingMedia.has(it.mediaId)}
              hint={rowHints.get(it.messageId)}
              onAuto={() => onAuto(it)}
              onManual={() => onManual(it)}
              onDelete={() => onDelete(it)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

interface BrokenRowProps {
  item: BrokenItem;
  busy: boolean;
  hint: RowHint | undefined;
  onAuto: () => void;
  onManual: () => void;
  onDelete: () => void;
}

function BrokenRow({ item, busy, hint, onAuto, onManual, onDelete }: BrokenRowProps) {
  const Icon = item.kind === "video" ? FileVideo : FileImage;
  const lib = useLibrariesStore((s) => s.current);
  const displayPath = item.lastKnownRelpath ?? "路径未知";
  const volumeLabel = item.lastKnownVolumeLabel;
  return (
    <li className="group flex items-center gap-3 px-3 py-2">
      {/* The thumbnail outlives the file: it's how you tell what went missing. */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-app-subtle text-app-muted">
        {item.hasThumb && lib ? (
          <img src={ipc.thumbSrc(lib, item.mediaId)} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <Icon size={18} />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="selectable truncate text-sm" data-tip={displayPath}>
          {displayPath.split(/[\\/]/).pop()}
        </div>
        <div className="truncate text-xs text-app-muted">
          {volumeLabel ? `${volumeLabel} · ` : ""}
          {formatSize(item.sizeBytes)}
        </div>
        {hint && (
          <div className={cn("mt-0.5 text-xs", hint.tone === "error" ? "text-app-danger" : "text-app-warning")}>{hint.text}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton label="自动匹配" size="sm" onClick={onAuto} disabled={busy} icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} />
        <IconButton label="指定新位置" size="sm" onClick={onManual} disabled={busy} icon={<FolderOpen size={14} />} />
        <IconButton label="删除消息" size="sm" onClick={onDelete} disabled={busy} icon={<Trash2 size={14} />} className="hover:text-app-danger" />
      </div>
    </li>
  );
}

function formatSize(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
}
