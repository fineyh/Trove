import { useEffect, useRef } from "react";
import type { Message } from "../../types";
import { MessageBubble } from "./MessageBubble";

interface MessageListProps {
  messages: readonly Message[];
  loading: boolean;
}

export function MessageList({ messages, loading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (loading && messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-app-muted">
        加载中...
      </div>
    );
  }
  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-app-muted">
        还没有消息，开始上传或输入吧
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
