import {
  ArrowRightLeft,
  CloudOff,
  FileText,
  Image,
  Lock,
  MessageSquare,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  Trash2,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useConversationsStore } from "../../stores/conversations";
import { currentLib, stillOn, useCurrentLibrary, useLibrariesStore } from "../../stores/libraries";
import { useSessionStore } from "../../stores/session";
import * as ipc from "../../ipc/client";
import type { Conversation, SearchHit } from "../../types";
import { cn } from "../../lib/cn";
import { toast } from "../../stores/toast";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { ContextMenu } from "../ui/ContextMenu";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ConvAvatar } from "../ui/ConvAvatar";

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function PreviewIcon({ kind }: { kind: Conversation["previewKind"] }) {
  switch (kind) {
    case "image":
      return <Image size={13} className="shrink-0 text-app-muted" />;
    case "video":
      return <Video size={13} className="shrink-0 text-app-muted" />;
    case "text":
      return <FileText size={13} className="shrink-0 text-app-muted" />;
    default:
      return null;
  }
}

interface ConversationRowProps {
  c: Conversation;
  onContextMenu: (e: React.MouseEvent, conv: Conversation) => void;
}

function ConversationRow({ c, onContextMenu }: ConversationRowProps) {
  const active = useSessionStore((s) => s.activeConversationId === c.id);
  const setActive = useSessionStore((s) => s.setActiveConversation);

  return (
    <button
      type="button"
      onClick={() => setActive(active ? null : c.id)}
      onContextMenu={(e) => onContextMenu(e, c)}
      className={cn(
        "mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
        active ? "bg-app-accent/10" : "hover:bg-app-subtle",
      )}
    >
      <ConvAvatar conv={c} size={44} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("truncate font-medium", active && "text-app-accent")}>{c.name}</span>
          <span className="shrink-0 text-[11px] text-app-muted">{formatTimeAgo(c.updatedAt)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {c.sourceOffline ? (
            <>
              <CloudOff size={13} className="shrink-0 text-amber-500" />
              <span className="truncate text-xs text-amber-600 dark:text-amber-400">源文件夹所在的盘未连接</span>
            </>
          ) : (
            <>
              <PreviewIcon kind={c.previewKind} />
              <span className="truncate text-xs text-app-muted">{c.preview ?? "暂无消息"}</span>
            </>
          )}
          {c.pinned && <Pin size={11} className="ml-auto shrink-0 text-app-muted" />}
        </div>
      </div>
    </button>
  );
}

function MessageHitRow({ hit }: { hit: SearchHit }) {
  const setActive = useSessionStore((s) => s.setActiveConversation);
  return (
    <button
      type="button"
      onClick={() => setActive(hit.convId)}
      className="mx-2 flex w-[calc(100%-1rem)] items-start gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-app-subtle"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-app-accent/10 text-app-accent">
        <MessageSquare size={16} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="truncate text-xs text-app-muted">{hit.convName}</div>
        <div className="truncate text-sm">{hit.snippet}</div>
      </div>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-app-muted">
      {children}
    </div>
  );
}

/** Which library this list belongs to, with its quick actions. */
function LibraryHeader() {
  const lib = useCurrentLibrary();
  const setLibraryDialog = useSessionStore((s) => s.setLibraryDialog);
  const lock = useLibrariesStore((s) => s.lock);
  const count = useConversationsStore((s) => s.list.length);
  if (!lib) return null;
  return (
    <div className="flex items-center gap-2 px-4 pb-1 pt-3.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold leading-5">{lib.name}</span>
        <span className="text-[11px] text-app-muted">
          {count} 个会话{lib.encrypted ? " · 加密库" : ""}
        </span>
      </div>
      {lib.encrypted && lib.unlocked && (
        <button
          type="button"
          title="锁定这个库"
          onClick={() => void lock(lib.id).catch((e) => toast.error("上锁失败", e))}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-app-muted transition-colors hover:bg-app-subtle hover:text-app-fg"
        >
          <Lock size={15} />
        </button>
      )}
      <button
        type="button"
        title="库设置"
        onClick={() => setLibraryDialog({ mode: "settings", id: lib.id })}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-app-muted transition-colors hover:bg-app-subtle hover:text-app-fg"
      >
        <Settings2 size={15} />
      </button>
    </div>
  );
}

export function ChatList() {
  const list = useConversationsStore((s) => s.list);
  const remove = useConversationsStore((s) => s.remove);
  const togglePinned = useConversationsStore((s) => s.togglePinned);
  const search = useConversationsStore((s) => s.search);
  const setSearch = useConversationsStore((s) => s.setSearch);
  const setNewConvOpen = useSessionStore((s) => s.setNewConversationOpen);
  const setActive = useSessionStore((s) => s.setActiveConversation);
  const setMoving = useSessionStore((s) => s.setMovingConversation);
  const libraryCount = useLibrariesStore((s) => s.list.length);

  const [hits, setHits] = useState<SearchHit[]>([]);
  const [menu, setMenu] = useState<{ convId: number; x: number; y: number } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const debounced = useDebouncedValue(search, 200);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length === 0) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const lib = currentLib();
    void ipc
      .search(lib, q)
      .then((res) => {
        if (!cancelled && stillOn(lib)) setHits(res);
      })
      .catch((e) => {
        if (!cancelled) toast.error("搜索失败", e);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const filteredConvs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.preview?.toLowerCase().includes(q) ?? false),
    );
  }, [list, search]);

  const messageHits = useMemo(() => hits.filter((h) => h.messageId !== null), [hits]);

  const showingSearch = search.trim().length > 0;

  const handleContextMenu = (e: React.MouseEvent, conv: Conversation) => {
    e.preventDefault();
    setMenu({ convId: conv.id, x: e.clientX, y: e.clientY });
  };

  const menuTarget = useMemo(
    () => (menu == null ? null : (list.find((c) => c.id === menu.convId) ?? null)),
    [list, menu],
  );

  const confirmTarget = useMemo(
    () => (confirmDeleteId == null ? null : (list.find((c) => c.id === confirmDeleteId) ?? null)),
    [list, confirmDeleteId],
  );

  const handleConfirmDelete = async () => {
    if (confirmDeleteId == null) return;
    const id = confirmDeleteId;
    setDeleteBusy(true);
    try {
      const wasActive = useSessionStore.getState().activeConversationId === id;
      await remove(id);
      if (wasActive) setActive(null);
      setConfirmDeleteId(null);
    } catch (e) {
      toast.error("删除会话失败", e);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-r border-app-border bg-app-panel">
      <LibraryHeader />
      <div className="flex items-center gap-2 px-3 pb-2 pt-1.5">
        <div className="relative flex flex-1 items-center">
          <Search size={14} className="absolute left-3 text-app-muted" aria-hidden />
          <input
            type="text"
            placeholder="搜索会话和消息"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-lg border border-transparent bg-app-subtle pl-8 pr-3 text-sm outline-none transition placeholder:text-app-muted/80 focus:border-app-accent/40 focus:bg-app-panel focus:ring-4 focus:ring-app-accent/10"
          />
        </div>
        <button
          type="button"
          title="新建会话"
          onClick={() => setNewConvOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-app-accent text-white shadow-sm transition hover:brightness-110"
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-2">
        {!showingSearch && list.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-app-subtle text-app-muted">
              <MessageSquare size={22} />
            </div>
            <div className="text-sm font-medium">这个库还是空的</div>
            <div className="text-xs leading-5 text-app-muted">点右上角的 + 新建会话，导入图片、视频或绑定一个文件夹。</div>
          </div>
        )}

        {showingSearch && <SectionLabel>会话</SectionLabel>}
        {filteredConvs.map((c) => (
          <ConversationRow key={c.id} c={c} onContextMenu={handleContextMenu} />
        ))}
        {showingSearch && filteredConvs.length === 0 && (
          <div className="px-4 py-1.5 text-xs text-app-muted">没有匹配的会话</div>
        )}

        {showingSearch && (
          <>
            <SectionLabel>消息</SectionLabel>
            {messageHits.length === 0 ? (
              <div className="px-4 py-1.5 text-xs text-app-muted">没有匹配的消息</div>
            ) : (
              messageHits.map((h) => <MessageHitRow key={`${h.convId}-${h.messageId}`} hit={h} />)
            )}
          </>
        )}
      </div>

      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={[
          {
            label: menuTarget?.pinned ? "取消置顶" : "置顶会话",
            icon: menuTarget?.pinned ? <PinOff size={14} /> : <Pin size={14} />,
            onClick: () => {
              if (menuTarget) {
                void togglePinned(menuTarget.id, !menuTarget.pinned).catch((e) =>
                  toast.error("操作失败", e),
                );
              }
              setMenu(null);
            },
          },
          {
            label: "移到其他库…",
            icon: <ArrowRightLeft size={14} />,
            disabled: libraryCount < 2,
            onClick: () => {
              if (menu) setMoving(menu.convId);
              setMenu(null);
            },
          },
          {
            label: "删除会话",
            icon: <Trash2 size={14} />,
            variant: "danger",
            onClick: () => {
              if (menu) {
                setConfirmDeleteId(menu.convId);
                setMenu(null);
              }
            },
          },
        ]}
        onClose={() => setMenu(null)}
      />

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="删除会话"
        message={
          confirmTarget ? (
            <>
              删除「<span className="font-medium">{confirmTarget.name}</span>」后，会话中的所有消息也会一并删除，此操作无法撤销。磁盘上的原文件不受影响。
            </>
          ) : (
            "此操作无法撤销。"
          )
        }
        confirmText="删除"
        variant="danger"
        busy={deleteBusy}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (!deleteBusy) setConfirmDeleteId(null);
        }}
      />
    </div>
  );
}
