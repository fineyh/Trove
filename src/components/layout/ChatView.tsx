import { CloudOff, MessagesSquare } from "lucide-react";
import { useEffect, useRef } from "react";
import { useConversationsStore } from "../../stores/conversations";
import { EMPTY_MESSAGES, useMessagesStore } from "../../stores/messages";
import { useSessionStore } from "../../stores/session";
import { Composer } from "../chat/Composer";
import { Lightbox } from "../chat/Lightbox";
import { MessageList } from "../chat/MessageList";
import { ConvAvatar } from "../ui/ConvAvatar";

export function ChatView() {
  const activeId = useSessionStore((s) => s.activeConversationId);
  const setDrawer = useSessionStore((s) => s.setProfileDrawerOpen);
  const lightboxId = useSessionStore((s) => s.lightboxMessageId);
  const conv = useConversationsStore((s) =>
    activeId ? (s.list.find((c) => c.id === activeId) ?? null) : null,
  );
  const messages =
    useMessagesStore((s) => (activeId !== null ? s.byConv[activeId] : undefined)) ??
    EMPTY_MESSAGES;
  const loading = useMessagesStore((s) =>
    activeId !== null ? s.loading[activeId] === true : false,
  );
  const loadingOlder = useMessagesStore((s) =>
    activeId !== null ? s.loadingOlder[activeId] === true : false,
  );
  const hasMore = useMessagesStore((s) =>
    activeId !== null ? s.hasMore[activeId] === true : false,
  );
  const loadMessages = useMessagesStore((s) => s.load);
  const loadOlder = useMessagesStore((s) => s.loadOlder);
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (activeId !== null) void loadMessages(activeId);
  }, [activeId, loadMessages]);

  if (!conv || activeId === null) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-app text-app-muted">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-app-subtle">
            <MessagesSquare size={26} />
          </div>
          <div className="text-[15px] font-medium text-app-fg/80">选择一个会话开始浏览</div>
          <div className="text-xs">或者点搜索框右侧的 + 新建一个</div>
        </div>
      </div>
    );
  }

  const isWatch = conv.kind === "folder_watch";

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-app-border bg-app-panel/80 px-4 backdrop-blur">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className="flex min-w-0 items-center gap-3 rounded-xl px-1.5 py-1 transition-colors hover:bg-app-subtle"
        >
          <ConvAvatar conv={conv} size={36} />
          <div className="flex min-w-0 flex-col items-start">
            <span className="truncate font-medium">{conv.name}</span>
            <span className="flex items-center gap-1 text-xs text-app-muted">
              {isWatch ? "路径会话 · 自动同步" : "手动会话"} · {conv.messageCount} 条
              {conv.sourceOffline && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  <CloudOff size={10} />
                  源盘未连接
                </span>
              )}
            </span>
          </div>
        </button>
      </header>

      <main ref={mainRef} className="flex-1 overflow-y-auto bg-app">
        <MessageList
          messages={messages}
          loading={loading}
          hasMore={hasMore}
          loadingOlder={loadingOlder}
          onLoadOlder={() => void loadOlder(activeId)}
          scrollContainerRef={mainRef}
        />
      </main>

      <Composer
        convId={activeId}
        disabled={isWatch}
        disabledReason={isWatch ? "路径会话的内容来自绑定的文件夹，不支持手动上传" : undefined}
      />

      {lightboxId !== null && <Lightbox convId={activeId} />}
    </div>
  );
}
