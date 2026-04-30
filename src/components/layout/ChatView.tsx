import { Paperclip, Pin, Send } from "lucide-react";
import { useConversationsStore } from "../../stores/conversations";
import { useSessionStore } from "../../stores/session";

export function ChatView() {
  const activeId = useSessionStore((s) => s.activeConversationId);
  const setDrawer = useSessionStore((s) => s.setProfileDrawerOpen);
  const conv = useConversationsStore((s) =>
    activeId ? s.list.find((c) => c.id === activeId) ?? null : null,
  );

  if (!conv) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-app-muted">
        <div className="text-center">
          <div className="mb-2 text-lg">选择一个会话开始浏览</div>
          <div className="text-sm">
            或者点击搜索框右侧的 + 创建一个新会话
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-app-border bg-app-panel px-4 py-2.5">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className="flex items-center gap-3 rounded-md px-1 py-1 hover:bg-app-subtle"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-app-accent/10 text-app-accent">
            {conv.name.slice(0, 1)}
          </div>
          <div className="flex flex-col items-start">
            <span className="font-medium">{conv.name}</span>
            <span className="text-xs text-app-muted">
              {conv.kind === "folder_watch" ? "路径会话" : "手动会话"}
            </span>
          </div>
        </button>
        {conv.pinned && <Pin size={16} className="text-app-muted" />}
      </header>

      <main className="flex-1 overflow-y-auto bg-app">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-6 text-sm text-app-muted">
          <div className="rounded-md border border-dashed border-app-border bg-app-panel/50 px-4 py-8 text-center">
            消息流将在 Phase 1 完成后渲染。
          </div>
        </div>
      </main>

      <footer className="border-t border-app-border bg-app-panel px-3 py-2">
        <div className="flex items-end gap-2">
          <button
            type="button"
            title="上传文件"
            disabled={conv.kind === "folder_watch"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-app-fg/70 hover:bg-app-subtle hover:text-app-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Paperclip size={18} />
          </button>
          <textarea
            rows={1}
            placeholder={
              conv.kind === "folder_watch"
                ? "路径会话不支持手动发送"
                : "输入消息..."
            }
            disabled={conv.kind === "folder_watch"}
            className="flex-1 resize-none rounded-md border border-transparent bg-app-subtle px-3 py-2 text-sm outline-none focus:border-app-accent/40 focus:bg-app-panel disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="button"
            title="发送"
            disabled={conv.kind === "folder_watch"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-app-accent text-white hover:opacity-90 disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </div>
      </footer>
    </div>
  );
}
