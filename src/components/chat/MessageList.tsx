import { useEffect, useRef } from "react";
import type { Message } from "../../types";
import { MessageBubble } from "./MessageBubble";
import { formatDayDivider, isSameDay } from "../../lib/datetime";

function DayDivider({ ts }: { ts: number }) {
  return (
    <div className="sticky top-2 z-10 flex justify-center py-1">
      <span className="rounded-full bg-app-subtle/80 px-3 py-0.5 text-[11px] text-app-muted backdrop-blur">
        {formatDayDivider(ts)}
      </span>
    </div>
  );
}

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

  // 按自然日把消息分组，使 sticky 日期头的粘附区间 = 整组高度，
  // 这样 header 会一直跟到当天最后一条消息，再被下一组顶替（接力效果）。
  const groups: { dayTs: number; items: Message[] }[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (last && isSameDay(last.dayTs, m.createdAt)) {
      last.items.push(m);
    } else {
      groups.push({ dayTs: m.createdAt, items: [m] });
    }
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      {groups.map((g) => (
        <div key={g.items[0].id} className="flex flex-col gap-3">
          <DayDivider ts={g.dayTs} />
          {g.items.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
