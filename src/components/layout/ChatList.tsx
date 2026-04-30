import { Plus, Search, Image, Video, FileText, Pin, Folder } from "lucide-react";
import { useMemo } from "react";
import { useConversationsStore } from "../../stores/conversations";
import { useSessionStore } from "../../stores/session";
import type { Conversation } from "../../types";
import { cn } from "../../lib/cn";

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

function ConversationRow({ c }: { c: Conversation }) {
  const active = useSessionStore((s) => s.activeConversationId === c.id);
  const setActive = useSessionStore((s) => s.setActiveConversation);

  return (
    <button
      type="button"
      onClick={() => setActive(c.id)}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
        "hover:bg-app-subtle",
        active && "bg-app-subtle",
      )}
    >
      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-app-accent/10 text-app-accent">
        {c.kind === "folder_watch" ? <Folder size={20} /> : c.name.slice(0, 1)}
        {c.unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-app-accent px-1 text-[11px] font-medium text-white">
            {c.unreadCount > 99 ? "99+" : c.unreadCount}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{c.name}</span>
          <span className="shrink-0 text-xs text-app-muted">
            {formatTimeAgo(c.updatedAt)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <PreviewIcon kind={c.previewKind} />
          <span className="truncate text-xs text-app-muted">
            {c.preview ?? "暂无消息"}
          </span>
          {c.pinned && (
            <Pin size={12} className="ml-auto text-app-muted" />
          )}
        </div>
      </div>
    </button>
  );
}

export function ChatList() {
  const list = useConversationsStore((s) => s.list);
  const search = useConversationsStore((s) => s.search);
  const setSearch = useConversationsStore((s) => s.setSearch);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.preview?.toLowerCase().includes(q) ?? false),
    );
  }, [list, search]);

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
          className="flex h-8 w-8 items-center justify-center rounded-md text-app-fg/70 hover:bg-app-subtle hover:text-app-fg"
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-app-muted">
            没有找到会话
          </div>
        )}
        {filtered.map((c) => (
          <ConversationRow key={c.id} c={c} />
        ))}
      </div>
    </div>
  );
}
