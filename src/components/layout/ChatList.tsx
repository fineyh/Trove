import { Plus, Search, Image, Video, FileText, Pin, Folder, MessageSquare, Lock, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useConversationsStore } from "../../stores/conversations";
import { useSessionStore } from "../../stores/session";
import { useVaultStore } from "../../stores/vault";
import * as ipc from "../../ipc/client";
import type { Conversation, SearchHit } from "../../types";
import { cn } from "../../lib/cn";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { ContextMenu } from "../ui/ContextMenu";
import { ConfirmDialog } from "../ui/ConfirmDialog";

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

function PreviewIcon({ kind }: { kind: Conversation["previewKind"] }) {
  switch (kind) {
    case "image":
      return <Image size={14} className="text-app-muted" />;
    case "video":
      return <Video size={14} className="text-app-muted" />;
    case "text":
      return <FileText size={14} className="text-app-muted" />;
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
  const openVaultDialog = useVaultStore((s) => s.openDialog);

  const locked = c.encrypted && !c.unlocked;
  const handleClick = () => {
    if (active) {
      setActive(null);
      return;
    }
    setActive(c.id);
    if (locked) {
      openVaultDialog("unlock-conv", c.id);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onContextMenu={(e) => onContextMenu(e, c)}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
        "hover:bg-app-subtle",
        active && "bg-app-subtle",
      )}
    >
      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-app-accent/10 font-semibold text-app-accent">
        {c.kind === "folder_watch" ? <Folder size={20} /> : c.name.slice(0, 1)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1 truncate font-medium">
            {c.name}
            {c.encrypted && (
              <Lock size={10} className="shrink-0 text-app-accent" />
            )}
          </span>
          <span className="shrink-0 text-xs text-app-muted">
            {formatTimeAgo(c.updatedAt)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <PreviewIcon kind={c.previewKind} />
          <span className="truncate text-xs text-app-muted">
            {locked ? "🔒 已锁定，点击解锁" : (c.preview ?? "暂无消息")}
          </span>
          {c.pinned && <Pin size={12} className="ml-auto text-app-muted" />}
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
      className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-app-subtle"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-app-accent/10 text-app-accent">
        <MessageSquare size={16} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="truncate text-xs text-app-muted">{hit.convName}</div>
        <div className="truncate text-sm">{hit.snippet}</div>
      </div>
    </button>
  );
}

export function ChatList() {
  const list = useConversationsStore((s) => s.list);
  const refresh = useConversationsStore((s) => s.refresh);
  const remove = useConversationsStore((s) => s.remove);
  const search = useConversationsStore((s) => s.search);
  const setSearch = useConversationsStore((s) => s.setSearch);
  const setNewConvOpen = useSessionStore((s) => s.setNewConversationOpen);
  const setActive = useSessionStore((s) => s.setActiveConversation);

  const [hits, setHits] = useState<SearchHit[]>([]);
  const [menu, setMenu] = useState<{ convId: number; x: number; y: number } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const debounced = useDebouncedValue(search, 200);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length === 0) {
      setHits([]);
      return;
    }
    let cancelled = false;
    void ipc
      .search(q)
      .then((res) => {
        if (!cancelled) setHits(res);
      })
      .catch((e) => {
        if (!cancelled) console.error("search failed", e);
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

  const messageHits = useMemo(
    () => hits.filter((h) => h.messageId !== null),
    [hits],
  );

  const showingSearch = search.trim().length > 0;

  const handleContextMenu = (e: React.MouseEvent, conv: Conversation) => {
    e.preventDefault();
    setMenu({ convId: conv.id, x: e.clientX, y: e.clientY });
  };

  const confirmTarget = useMemo(
    () => (confirmDeleteId == null ? null : list.find((c) => c.id === confirmDeleteId) ?? null),
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
      console.error("delete conversation failed", e);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-r border-app-border bg-app-panel">
      <div className="flex items-center gap-2 border-b border-app-border px-3 py-2.5">
        <div className="relative flex flex-1 items-center">
          <Search
            size={14}
            className="absolute left-2.5 text-app-muted"
            aria-hidden
          />
          <input
            type="text"
            placeholder="搜索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-transparent bg-app-subtle py-1.5 pl-8 pr-3 text-sm outline-none focus:border-app-accent/40 focus:bg-app-panel"
          />
        </div>
        <button
          type="button"
          title="新建会话"
          onClick={() => setNewConvOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-app-fg/70 hover:bg-app-subtle hover:text-app-fg"
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!showingSearch && filteredConvs.length === 0 && list.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-app-muted">
            还没有会话，点击右上 + 新建一个
          </div>
        )}

        {showingSearch && (
          <div className="px-3 pt-2 text-xs font-medium uppercase tracking-wide text-app-muted">
            会话
          </div>
        )}
        {filteredConvs.map((c) => (
          <ConversationRow key={c.id} c={c} onContextMenu={handleContextMenu} />
        ))}
        {showingSearch && filteredConvs.length === 0 && (
          <div className="px-4 py-2 text-xs text-app-muted">
            没有匹配的会话
          </div>
        )}

        {showingSearch && (
          <>
            <div className="border-t border-app-border px-3 pt-3 text-xs font-medium uppercase tracking-wide text-app-muted">
              消息
            </div>
            {messageHits.length === 0 ? (
              <div className="px-4 py-2 text-xs text-app-muted">
                没有匹配的消息
              </div>
            ) : (
              messageHits.map((h) => (
                <MessageHitRow key={`${h.convId}-${h.messageId}`} hit={h} />
              ))
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
              删除「<span className="font-medium">{confirmTarget.name}</span>」后，会话中的所有消息也会一并删除，此操作无法撤销。
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
