import { Lock, LockOpen, Pin } from "lucide-react";
import { useEffect } from "react";
import { useConversationsStore } from "../../stores/conversations";
import { EMPTY_MESSAGES, useMessagesStore } from "../../stores/messages";
import { useSessionStore } from "../../stores/session";
import { useVaultStore } from "../../stores/vault";
import * as ipc from "../../ipc/client";
import { Composer } from "../chat/Composer";
import { Lightbox } from "../chat/Lightbox";
import { MessageList } from "../chat/MessageList";

export function ChatView() {
  const activeId = useSessionStore((s) => s.activeConversationId);
  const setDrawer = useSessionStore((s) => s.setProfileDrawerOpen);
  const lightboxId = useSessionStore((s) => s.lightboxMessageId);
  const conv = useConversationsStore((s) =>
    activeId ? s.list.find((c) => c.id === activeId) ?? null : null,
  );
  const refreshConvs = useConversationsStore((s) => s.refresh);
  const messages =
    useMessagesStore((s) =>
      activeId !== null ? s.byConv[activeId] : undefined,
    ) ?? EMPTY_MESSAGES;
  const loading = useMessagesStore((s) =>
    activeId !== null ? s.loading[activeId] === true : false,
  );
  const loadMessages = useMessagesStore((s) => s.load);
  const openVaultDialog = useVaultStore((s) => s.openDialog);

  const locked = conv?.encrypted === true && conv.unlocked === false;

  useEffect(() => {
    if (activeId !== null && !locked) {
      void loadMessages(activeId);
    }
  }, [activeId, locked, loadMessages]);

  if (!conv || activeId === null) {
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

  const isWatch = conv.kind === "folder_watch";

  const handleLockConv = async () => {
    await ipc.lockConversation(activeId);
    await refreshConvs();
  };

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-app-border bg-app-panel px-4 py-2.5">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className="flex items-center gap-3 rounded-md px-1 py-1 hover:bg-app-subtle"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-app-accent/10 font-semibold text-app-accent">
            {conv.name.slice(0, 1)}
          </div>
          <div className="flex flex-col items-start">
            <span className="flex items-center gap-1.5 font-medium">
              {conv.name}
              {conv.encrypted && (
                <Lock size={12} className="text-app-accent" />
              )}
            </span>
            <span className="text-xs text-app-muted">
              {isWatch ? "路径会话 · 自动同步" : "手动会话"} ·{" "}
              {conv.messageCount} 条
              {conv.encrypted && (locked ? " · 已锁定" : " · 已解锁")}
            </span>
          </div>
        </button>
        <div className="flex items-center gap-2">
          {conv.encrypted && !locked && (
            <button
              type="button"
              title="重新上锁此会话"
              onClick={handleLockConv}
              className="flex h-7 w-7 items-center justify-center rounded text-app-muted hover:bg-app-subtle hover:text-app-fg"
            >
              <LockOpen size={14} />
            </button>
          )}
          {conv.pinned && <Pin size={16} className="text-app-muted" />}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto bg-app">
        {locked ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-app-muted">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-app-accent/10 text-app-accent">
              <Lock size={24} />
            </div>
            <div className="text-sm">这是加密会话，请先解锁</div>
            <button
              type="button"
              onClick={() => openVaultDialog("unlock-conv", activeId)}
              className="rounded-md bg-app-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              解锁会话
            </button>
          </div>
        ) : (
          <MessageList messages={messages} loading={loading} />
        )}
      </main>

      {!locked && (
        <Composer
          convId={activeId}
          disabled={isWatch}
          disabledReason={isWatch ? "路径会话不支持手动上传" : undefined}
        />
      )}

      {lightboxId !== null && !locked && <Lightbox convId={activeId} />}
    </div>
  );
}
