import { X } from "lucide-react";
import { useConversationsStore } from "../../stores/conversations";
import { EMPTY_MESSAGES, useMessagesStore } from "../../stores/messages";
import { useSessionStore } from "../../stores/session";
import { MediaGrid } from "./MediaGrid";

export function ProfileDrawer() {
  const open = useSessionStore((s) => s.profileDrawerOpen);
  const setOpen = useSessionStore((s) => s.setProfileDrawerOpen);
  const activeId = useSessionStore((s) => s.activeConversationId);
  const conv = useConversationsStore((s) =>
    activeId ? s.list.find((c) => c.id === activeId) ?? null : null,
  );
  const messages =
    useMessagesStore((s) =>
      activeId !== null ? s.byConv[activeId] : undefined,
    ) ?? EMPTY_MESSAGES;

  if (!open || !conv) return null;

  const close = () => setOpen(false);

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/30" onClick={close} />
      <aside className="fixed right-0 top-0 z-40 flex h-full w-96 flex-col border-l border-app-border bg-app-panel shadow-xl">
        <header className="flex items-center justify-between border-b border-app-border px-4 py-3">
          <div>
            <div className="text-sm font-semibold">{conv.name}</div>
            <div className="text-xs text-app-muted">
              {conv.messageCount} 条消息 ·{" "}
              {conv.kind === "folder_watch" ? "路径会话" : "手动会话"}
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded text-app-muted hover:bg-app-subtle"
          >
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-hidden">
          <MediaGrid messages={messages} />
        </div>
      </aside>
    </>
  );
}
