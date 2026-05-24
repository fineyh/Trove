import {
  ChevronDown,
  ChevronRight,
  FileImage,
  FileVideo,
  FileWarning,
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
import type {
  BrokenGroup,
  BrokenItem,
  RepairOutcome,
  RepairScope,
} from "../../../types";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { cn } from "../../../lib/cn";

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
      const list = await ipc.listBrokenPointers();
      setGroups(list);
      setLoadError(null);
    } catch (e) {
      console.error("list_broken_pointers failed", e);
      setLoadError(String(e));
      setGroups([]);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      const outcome = await ipc.repairMedia({ mediaId, scope, explicitPath });
      applyRepairOutcome(mediaId, outcome, sourceMessageId);
      if (outcome.status === "repaired") {
        // Conversation messages should refresh too (preview, etc.)
        void refreshConvs();
      }
    } catch (e) {
      console.error("repair_media failed", e);
      setHint(sourceMessageId, { tone: "error", text: `修复失败: ${String(e)}` });
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
      setHint(item.messageId, { tone: "error", text: `打开文件选择器失败: ${String(e)}` });
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
      await ipc.deleteMessage(pendingDelete.item.messageId);
      // Reload list — backend may have cascaded media + broken_pointers cleanup.
      await loadList();
      void refreshConvs();
      setPendingDelete(null);
    } catch (e) {
      console.error("delete_message failed", e);
      setHint(pendingDelete.item.messageId, {
        tone: "error",
        text: `删除失败: ${String(e)}`,
      });
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[80vh] w-[min(720px,92vw)] flex-col rounded-lg border border-app-border bg-app-panel shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-app-border px-5 py-3">
          <div className="flex items-center gap-2 text-base font-semibold">
            <FileWarning size={16} className="text-amber-500" />
            失效文件管理
            {groups !== null && (
              <span className="text-sm font-normal text-app-muted">
                共 {totalCount} 个
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-app-muted hover:bg-app-subtle"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loadError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
              加载失败：{loadError}
            </div>
          )}
          {groups === null ? (
            <div className="flex items-center justify-center py-12 text-sm text-app-muted">
              <Loader2 size={14} className="mr-2 animate-spin" />
              加载中...
            </div>
          ) : groups.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-app-muted">
              暂无失效文件
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
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
                  onDelete={(it) =>
                    setPendingDelete({ convName: g.convName, item: it })
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        variant="danger"
        title="删除此消息"
        message={
          pendingDelete
            ? `确认从「${pendingDelete.convName}」中删除此消息？文件本身在磁盘上不会动。`
            : ""
        }
        confirmText="删除"
        busy={deleteBusy}
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
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
    <li className="overflow-hidden rounded-md border border-app-border">
      <div
        className="flex cursor-pointer items-center gap-2 bg-app-subtle/30 px-3 py-2 hover:bg-app-subtle/60"
        onClick={onToggle}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <div className="flex-1 truncate text-sm font-medium">
          {group.convName}
          <span className="ml-2 text-xs font-normal text-app-muted">
            {group.items.length} 个失效
          </span>
        </div>
        {batching && (
          <span className="text-xs text-app-muted">
            处理中 {batchProgress!.done}/{batchProgress!.total}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAutoAll();
          }}
          disabled={batching}
          className="flex items-center gap-1 rounded border border-app-border bg-app-panel px-2 py-1 text-xs hover:bg-app-subtle disabled:opacity-40"
        >
          <Wand2 size={12} />
          自动匹配全部
        </button>
      </div>
      {expanded && (
        <ul className="divide-y divide-app-border">
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
  const displayPath = item.lastKnownRelpath ?? "(路径未知)";
  const volumeLabel = item.lastKnownVolumeLabel;
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-app-subtle text-app-muted">
        <Icon size={18} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="truncate font-mono text-xs" title={displayPath}>
          {displayPath}
        </div>
        <div className="truncate text-[11px] text-app-muted">
          {volumeLabel ? `${volumeLabel} · ` : ""}
          {formatSize(item.sizeBytes)}
        </div>
        {hint && (
          <div
            className={cn(
              "mt-1 text-[11px]",
              hint.tone === "error" ? "text-red-500" : "text-amber-500",
            )}
          >
            {hint.text}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onAuto}
          disabled={busy}
          title="按当前默认模式自动匹配"
          className="flex h-7 w-7 items-center justify-center rounded text-app-muted hover:bg-app-subtle hover:text-app-fg disabled:opacity-40"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
        </button>
        <button
          type="button"
          onClick={onManual}
          disabled={busy}
          title="手动选择新位置"
          className="flex h-7 w-7 items-center justify-center rounded text-app-muted hover:bg-app-subtle hover:text-app-fg disabled:opacity-40"
        >
          <FolderOpen size={14} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          title="删除此消息"
          className="flex h-7 w-7 items-center justify-center rounded text-app-muted hover:bg-app-subtle hover:text-red-500 disabled:opacity-40"
        >
          <Trash2 size={14} />
        </button>
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
