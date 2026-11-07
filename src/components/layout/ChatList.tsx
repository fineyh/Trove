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
import { formatListTime } from "../../lib/datetime";
import { ContextMenu } from "../ui/ContextMenu";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ConvAvatar } from "../ui/ConvAvatar";
import { Button, IconButton } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";


function PreviewIcon({ kind }: { kind: Conversation["previewKind"] }) {
  switch (kind) {
    case "image":
      return <Image size={13} className="shrink-0" />;
    case "video":
      return <Video size={13} className="shrink-0" />;
    case "other":
      return <FileText size={13} className="shrink-0" />;
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
      aria-current={active}
      className={cn(
        "flex h-16 w-full items-center gap-3 rounded-xl px-2.5 text-left transition-colors duration-fast",
        active ? "bg-app-accent/10" : "hover:bg-app-hover/[0.04]",
      )}
    >
      <ConvAvatar conv={c} size={42} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{c.name}</span>
          <span className="shrink-0 text-2xs text-app-muted">{formatListTime(c.updatedAt)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-app-muted">
          {c.sourceOffline ? (
            <span className="flex min-w-0 items-center gap-1 text-app-warning">
              <CloudOff size={13} className="shrink-0" />
              <span className="truncate">磁盘未连接</span>
            </span>
          ) : (
            <>
              <PreviewIcon kind={c.previewKind} />
              <span className="truncate">{c.preview ?? "没有内容"}</span>
            </>
          )}
          {c.pinned && <Pin size={12} className="ml-auto shrink-0 -rotate-45" />}
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
      className="flex w-full flex-col rounded-xl px-2.5 py-2 text-left transition-colors duration-fast hover:bg-app-hover/[0.04]"
    >
      <span className="truncate text-xs text-app-muted">{hit.convName}</span>
      <span className="truncate text-sm">{hit.snippet}</span>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 pb-1 pt-3 text-xs font-medium text-app-muted">{children}</div>;
}

/** Which library this list belongs to, with its quick actions. */
function LibraryHeader() {
  const lib = useCurrentLibrary();
  const setLibraryDialog = useSessionStore((s) => s.setLibraryDialog);
  const lock = useLibrariesStore((s) => s.lock);
  if (!lib) return null;
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-1 pl-4 pr-2.5">
      <span className="min-w-0 flex-1 truncate text-base font-semibold">{lib.name}</span>
      {lib.encrypted && lib.unlocked && (
        <IconButton
          label="锁定这个库"
          size="sm"
          icon={<Lock size={15} />}
          onClick={() => void lock(lib.id).catch((e) => toast.error("锁定失败", e))}
        />
      )}
      <IconButton
        label="库设置"
        size="sm"
        icon={<Settings2 size={15} />}
        onClick={() => setLibraryDialog({ mode: "settings", id: lib.id })}
      />
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
    <div className="flex h-full w-[300px] shrink-0 flex-col border-x border-app-border bg-app-panel">
      <LibraryHeader />
      <div className="flex items-center gap-2 px-3 pb-2">
        <div className="relative flex flex-1 items-center">
          <Search size={14} className="pointer-events-none absolute left-2.5 text-app-muted" aria-hidden />
          <input
            type="text"
            placeholder="搜索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearch("");
            }}
            className="h-8 w-full rounded-lg bg-app-subtle pl-8 pr-2.5 text-sm outline-none transition-colors duration-fast placeholder:text-app-muted focus:bg-app-panel focus:ring-2 focus:ring-app-accent/25"
          />
        </div>
        <IconButton
          label="新建会话"
          icon={<Plus size={18} />}
          onClick={() => setNewConvOpen(true)}
          className="bg-app-subtle"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {!showingSearch && list.length === 0 && (
          <EmptyState
            className="py-16"
            icon={<MessageSquare size={28} strokeWidth={1.5} />}
            title="还没有会话"
            description="导入照片、视频，或同步一个文件夹"
            action={
              <Button size="sm" icon={<Plus size={14} />} onClick={() => setNewConvOpen(true)}>
                新建会话
              </Button>
            }
          />
        )}

        {showingSearch && <SectionLabel>会话</SectionLabel>}
        {filteredConvs.map((c) => (
          <ConversationRow key={c.id} c={c} onContextMenu={handleContextMenu} />
        ))}
        {showingSearch && filteredConvs.length === 0 && <div className="px-2.5 py-1.5 text-xs text-app-muted">无结果</div>}

        {showingSearch && (
          <>
            <SectionLabel>消息</SectionLabel>
            {messageHits.length === 0 ? (
              <div className="px-2.5 py-1.5 text-xs text-app-muted">无结果</div>
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
            label: menuTarget?.pinned ? "取消置顶" : "置顶",
            icon: menuTarget?.pinned ? <PinOff size={15} /> : <Pin size={15} />,
            onClick: () => {
              if (menuTarget) {
                void togglePinned(menuTarget.id, !menuTarget.pinned).catch((e) =>
                  toast.error("置顶失败", e),
                );
              }
              setMenu(null);
            },
          },
          {
            label: "移到其他库…",
            icon: <ArrowRightLeft size={15} />,
            disabled: libraryCount < 2,
            onClick: () => {
              if (menu) setMoving(menu.convId);
              setMenu(null);
            },
          },
          "separator",
          {
            label: "删除会话",
            icon: <Trash2 size={15} />,
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
              「<span className="font-medium text-app-fg">{confirmTarget.name}</span>」中的消息会一并删除，磁盘上的文件不受影响。
            </>
          ) : (
            ""
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
