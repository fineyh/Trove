import { CloudOff, FolderSync, MessagesSquare, PanelRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { useConversationsStore } from "../../stores/conversations";
import { EMPTY_MESSAGES, useMessagesStore } from "../../stores/messages";
import { useSessionStore } from "../../stores/session";
import { Composer } from "../chat/Composer";
import { Lightbox } from "../chat/Lightbox";
import { MessageList } from "../chat/MessageList";
import { IconButton } from "../ui/Button";
import { ConvAvatar } from "../ui/ConvAvatar";
import { EmptyState } from "../ui/EmptyState";
import { ImportProgressBar } from "../ui/ImportProgressBar";
import { DragStrip } from "../ui/WindowControls";
import { cn } from "../../lib/cn";

export function ChatView() {
  const activeId = useSessionStore((s) => s.activeConversationId);
  const setDrawer = useSessionStore((s) => s.setProfileDrawerOpen);
  const drawerOpen = useSessionStore((s) => s.profileDrawerOpen);
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
      <div className="relative flex h-full flex-1 items-center justify-center bg-app-panel">
        <DragStrip />
        <EmptyState icon={<MessagesSquare size={32} strokeWidth={1.5} />} title="选择一个会话" />
      </div>
    );
  }

  const isWatch = conv.kind === "folder_watch";

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-app-panel">
      <header
        data-drag-region
        className={cn(
          "flex h-[52px] shrink-0 items-center gap-2 border-b border-app-border pl-3",
          // The rightmost pane keeps the window buttons' corner free.
          drawerOpen ? "pr-2.5" : "pr-[calc(var(--wc-width)+10px)]",
        )}
      >
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className="flex min-w-0 items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 transition-colors duration-fast hover:bg-app-hover/[0.04]"
        >
          <ConvAvatar conv={conv} size={32} />
          <div className="flex min-w-0 flex-col items-start">
            <span className="truncate text-sm font-semibold leading-5">{conv.name}</span>
            <span className="flex items-center gap-1 text-2xs text-app-muted">
              {conv.sourceOffline ? (
                <span className="flex items-center gap-1 text-app-warning">
                  <CloudOff size={11} />
                  磁盘未连接
                </span>
              ) : (
                <>
                  {isWatch && (
                    <>
                      <FolderSync size={11} />
                      同步文件夹 ·
                    </>
                  )}
                  {conv.messageCount.toLocaleString()} 条
                </>
              )}
            </span>
          </div>
        </button>
        <div className="flex-1" />
        <IconButton
          label="会话信息"
          icon={<PanelRight size={18} />}
          active={drawerOpen}
          onClick={() => setDrawer(!drawerOpen)}
        />
      </header>

      <main ref={mainRef} className="flex-1 overflow-y-auto">
        <MessageList
          messages={messages}
          loading={loading}
          hasMore={hasMore}
          loadingOlder={loadingOlder}
          onLoadOlder={() => void loadOlder(activeId)}
          scrollContainerRef={mainRef}
        />
      </main>

      {isWatch ? <ImportProgressBar convId={activeId} /> : <Composer convId={activeId} />}

      {lightboxId !== null && <Lightbox convId={activeId} />}
    </div>
  );
}
