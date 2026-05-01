import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Message } from "../../types";
import { mediaUrl } from "../../ipc/client";
import { EMPTY_MESSAGES, useMessagesStore } from "../../stores/messages";
import { useSessionStore } from "../../stores/session";

interface LightboxProps {
  convId: number;
}

export function Lightbox({ convId }: LightboxProps) {
  const messages =
    useMessagesStore((s) => s.byConv[convId]) ?? EMPTY_MESSAGES;
  const registerPlay = useMessagesStore((s) => s.registerPlay);
  const activeId = useSessionStore((s) => s.lightboxMessageId);
  const close = useSessionStore((s) => s.closeLightbox);
  const open = useSessionStore((s) => s.openLightbox);

  const playable = useMemo(
    () => messages.filter((m) => m.media && m.media.state === "live"),
    [messages],
  );
  const idx = useMemo(
    () => playable.findIndex((m) => m.id === activeId),
    [playable, activeId],
  );
  const current: Message | null = idx >= 0 ? playable[idx] : null;

  const goPrev = useCallback(() => {
    if (idx > 0) open(playable[idx - 1].id);
  }, [idx, playable, open]);
  const goNext = useCallback(() => {
    if (idx >= 0 && idx < playable.length - 1) open(playable[idx + 1].id);
  }, [idx, playable, open]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, close, goPrev, goNext]);

  const playedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!current) return;
    if (current.media?.kind === "video" && !playedRef.current.has(current.id)) {
      playedRef.current.add(current.id);
      void registerPlay(current.id);
    }
  }, [current, registerPlay]);

  if (!current || !current.media) return null;

  const url = mediaUrl(current.media.absolutePath);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={close}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        title="关闭 (Esc)"
      >
        <X size={20} />
      </button>

      {idx > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          className="absolute left-4 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          title="上一个 (←)"
        >
          <ChevronLeft size={24} />
        </button>
      )}
      {idx < playable.length - 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          className="absolute right-4 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          title="下一个 (→)"
        >
          <ChevronRight size={24} />
        </button>
      )}

      <div
        className="flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {current.media.kind === "image" ? (
          <img
            src={url}
            alt={current.caption ?? ""}
            className="max-h-[85vh] max-w-[90vw] object-contain"
          />
        ) : (
          <video
            src={url}
            controls
            autoPlay
            className="max-h-[85vh] max-w-[90vw]"
          />
        )}
        {current.caption && (
          <div className="max-w-2xl text-center text-sm text-white/80">
            {current.caption}
          </div>
        )}
      </div>
    </div>
  );
}
