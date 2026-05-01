import { useEffect, useRef } from "react";
import { Play } from "lucide-react";
import type { Message } from "../../types";
import { mediaUrl } from "../../ipc/client";
import { useSessionStore } from "../../stores/session";

interface MessageBubbleProps {
  message: Message;
}

function formatPlayCount(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function ImageMessage({ message }: MessageBubbleProps) {
  const open = useSessionStore((s) => s.openLightbox);
  const url = mediaUrl(message.media!.absolutePath);
  return (
    <button
      type="button"
      onClick={() => open(message.id)}
      className="block max-w-md overflow-hidden rounded-lg border border-app-border bg-black/5"
    >
      <img
        src={url}
        alt={message.caption ?? ""}
        loading="lazy"
        className="h-auto max-h-[60vh] w-full object-contain"
      />
    </button>
  );
}

function VideoMessage({ message }: MessageBubbleProps) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const open = useSessionStore((s) => s.openLightbox);
  const url = mediaUrl(message.media!.absolutePath);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            void el.play().catch(() => {});
          } else {
            el.pause();
          }
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <button
      type="button"
      onClick={() => open(message.id)}
      className="relative block max-w-md overflow-hidden rounded-lg border border-app-border bg-black"
    >
      <video
        ref={ref}
        src={url}
        muted
        loop
        playsInline
        preload="metadata"
        className="h-auto max-h-[60vh] w-full object-contain"
      />
      <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
        <Play size={11} fill="currentColor" />
        {formatPlayCount(message.playCount)}
      </span>
    </button>
  );
}

function FileMessage({ message }: MessageBubbleProps) {
  return (
    <div className="max-w-md rounded-lg border border-app-border bg-app-panel px-3 py-2 text-sm">
      <div className="font-medium">{message.caption ?? "文件"}</div>
      <div className="mt-0.5 text-xs text-app-muted">
        {message.media?.kind ?? "文件"}
      </div>
    </div>
  );
}

function TextMessage({ message }: MessageBubbleProps) {
  return (
    <div className="max-w-md whitespace-pre-wrap break-words rounded-lg bg-app-accent px-3 py-2 text-sm text-white">
      {message.caption}
    </div>
  );
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const time = new Date(message.createdAt).toLocaleString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  let body: React.ReactNode;
  if (message.media?.kind === "image") body = <ImageMessage message={message} />;
  else if (message.media?.kind === "video") body = <VideoMessage message={message} />;
  else if (message.media) body = <FileMessage message={message} />;
  else body = <TextMessage message={message} />;

  return (
    <div className="flex flex-col gap-1">
      {body}
      {message.media && message.caption && (
        <div className="max-w-md text-sm text-app-fg/80">{message.caption}</div>
      )}
      <div className="text-[11px] text-app-muted">{time}</div>
    </div>
  );
}
