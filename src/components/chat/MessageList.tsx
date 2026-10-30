import {
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import { Loader2 } from "lucide-react";
import type { Message } from "../../types";
import { MessageBubble } from "./MessageBubble";
import { formatDayDivider, isSameDay } from "../../lib/datetime";

/** 吸顶线距容器顶部的距离，对齐 `sticky top-2`（0.5rem = 8px）。 */
const STICKY_OFFSET = 8;
/** 停止滚动多久后让吸顶的悬浮头淡出。 */
const IDLE_FADE_MS = 1500;
/** 距顶部多少像素内开始拉取更早的一页。 */
const LOAD_OLDER_AT_PX = 300;

function DayDivider({ ts }: { ts: number }) {
  return (
    <div className="day-divider sticky top-2 z-10 flex justify-center py-1 transition-opacity duration-300">
      <span className="rounded-full bg-app-subtle/80 px-3 py-0.5 text-[11px] text-app-muted backdrop-blur">
        {formatDayDivider(ts)}
      </span>
    </div>
  );
}

interface MessageListProps {
  messages: readonly Message[];
  loading: boolean;
  /** 还有更早的消息可以加载。 */
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  /** 外层滚动容器（ChatView 的 <main>），用于监听滚动 + 计算吸顶。 */
  scrollContainerRef: RefObject<HTMLElement | null>;
}

export function MessageList({
  messages,
  loading,
  hasMore,
  loadingOlder,
  onLoadOlder,
  scrollContainerRef,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const convId = messages.length > 0 ? messages[0].convId : null;

  // 滚动处理器是命令式的、只挂一次，所以把会变的值放进 ref 里给它读。
  const loadOlderRef = useRef(onLoadOlder);
  loadOlderRef.current = onLoadOlder;
  const armedRef = useRef(false);
  armedRef.current = hasMore && !loadingOlder && messages.length > 0;

  // 滚动位置的两种处境：
  //   - 往上翻页插入了更早的消息 → 按插入高度补偿 scrollTop，保持阅读位置
  //   - 切会话 / 追加新消息 → 贴到底部
  const prevRef = useRef({
    convId: null as number | null,
    firstId: null as number | null,
    len: 0,
    scrollHeight: 0,
  });

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const firstId = messages.length > 0 ? messages[0].id : null;
    const prev = prevRef.current;
    const switched = convId !== prev.convId;
    const prepended =
      !switched &&
      firstId !== null &&
      prev.firstId !== null &&
      firstId !== prev.firstId &&
      messages.length > prev.len;

    if (container && prepended) {
      // 注意：此时图片还没解码完，高度仍会继续长，所以补偿是近似的。
      container.scrollTop += container.scrollHeight - prev.scrollHeight;
    } else if (switched || messages.length !== prev.len) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }

    prevRef.current = {
      convId,
      firstId,
      len: messages.length,
      scrollHeight: container?.scrollHeight ?? 0,
    };

    // 首页没撑满视口时根本滚不动，补一次自动拉取，直到撑满或没有更早的了。
    if (
      container &&
      armedRef.current &&
      container.scrollHeight <= container.clientHeight
    ) {
      armedRef.current = false;
      loadOlderRef.current();
    }
  }, [messages, convId, scrollContainerRef]);

  // 悬浮日期头的两个状态都用命令式 + CSS 处理，避免每帧 re-render：
  //   - 容器 data-scrolling：滚动中为 true，停 IDLE_FADE_MS 后转 false
  //   - 当前吸顶分隔条 data-stuck：跨越吸顶线的那一组的分隔条
  // CSS 规则（styles.css）：data-scrolling="false" 且 data-stuck 时淡出。
  useEffect(() => {
    const container = scrollContainerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;

    let raf = 0;
    let idleTimer: number | undefined;
    let stuckEl: HTMLElement | null = null;

    const updateStuck = () => {
      raf = 0;
      const lineY = container.getBoundingClientRect().top + STICKY_OFFSET;
      const groups =
        inner.querySelectorAll<HTMLElement>("[data-day-group]");
      // 跨越吸顶线（top 已划过线、bottom 仍在线下方）的那一组 = 其分隔条正被钉在顶部
      let current: HTMLElement | null = null;
      for (const g of groups) {
        const r = g.getBoundingClientRect();
        if (r.top <= lineY && r.bottom > lineY) {
          current = g;
          break;
        }
      }
      const nextStuck =
        current?.querySelector<HTMLElement>(".day-divider") ?? null;
      if (nextStuck !== stuckEl) {
        stuckEl?.removeAttribute("data-stuck");
        nextStuck?.setAttribute("data-stuck", "true");
        stuckEl = nextStuck;
      }
    };

    const onScroll = () => {
      container.setAttribute("data-scrolling", "true");
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        container.setAttribute("data-scrolling", "false");
      }, IDLE_FADE_MS);
      if (!raf) raf = requestAnimationFrame(updateStuck);
      // 快到顶了就拉上一页；armed 立刻置否，等 props 回来再重新武装，
      // 免得一次滚动连发好几个请求。
      if (armedRef.current && container.scrollTop <= LOAD_OLDER_AT_PX) {
        armedRef.current = false;
        loadOlderRef.current();
      }
    };

    container.setAttribute("data-scrolling", "false");
    updateStuck();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      window.clearTimeout(idleTimer);
      if (raf) cancelAnimationFrame(raf);
      container.removeAttribute("data-scrolling");
      stuckEl?.removeAttribute("data-stuck");
    };
  }, [scrollContainerRef, messages.length]);

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
    <div ref={innerRef} className="flex flex-col gap-3 px-4 py-4">
      {hasMore && (
        <div className="flex justify-center py-1">
          {loadingOlder ? (
            <span className="flex items-center gap-1.5 text-xs text-app-muted">
              <Loader2 size={12} className="animate-spin" />
              加载更早的消息
            </span>
          ) : (
            <button
              type="button"
              onClick={onLoadOlder}
              className="rounded-full border border-app-border px-3 py-0.5 text-[11px] text-app-muted hover:bg-app-subtle hover:text-app-fg"
            >
              加载更早的消息
            </button>
          )}
        </div>
      )}
      {groups.map((g) => (
        <div
          key={g.items[0].id}
          data-day-group
          className="flex flex-col gap-3"
        >
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
