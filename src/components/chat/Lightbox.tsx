import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
  RotateCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Message } from "../../types";
import { mediaSrc } from "../../ipc/client";
import { useLibrariesStore } from "../../stores/libraries";
import { EMPTY_MEDIA, useConvMediaStore } from "../../stores/convMedia";
import { useMessagesStore } from "../../stores/messages";
import { useSessionStore } from "../../stores/session";
import { isImageMedia } from "../../lib/media";
import { useDisplayableImageUrl } from "../../lib/useDisplayableImageUrl";
import { useViewerTransform } from "../../lib/useViewerTransform";
import { RotatableVideo } from "../ui/RotatableVideo";

/** Things this viewer can show: reachable images and videos. */
function viewable(m: Message): boolean {
  return (
    m.media != null &&
    m.media.status === "ok" &&
    (isImageMedia(m.media) || m.media.kind === "video")
  );
}

interface LightboxProps {
  convId: number;
}

export function Lightbox({ convId }: LightboxProps) {
  // Sourced from the conversation's media sequence, not the chat's loaded
  // slice: paging the chat used to cap this viewer at the newest `PAGE_SIZE`
  // messages, so in a folder conversation with thousands of photos the arrow
  // keys stopped a few dozen in and the rest were unreachable.
  const media = useConvMediaStore((s) => s.byConv[convId]) ?? EMPTY_MEDIA;
  const mediaLoading = useConvMediaStore((s) => s.loading[convId] === true);
  const loadingOlder = useConvMediaStore((s) => s.loadingOlder[convId] === true);
  const hasMore = useConvMediaStore((s) => s.hasMore[convId] === true);
  const loadOlder = useConvMediaStore((s) => s.loadOlder);
  const ensureContains = useConvMediaStore((s) => s.ensureContains);

  const registerPlay = useMessagesStore((s) => s.registerPlay);
  const activeId = useSessionStore((s) => s.lightboxMessageId);
  const close = useSessionStore((s) => s.closeLightbox);
  const lib = useLibrariesStore((s) => s.current) ?? "";
  const open = useSessionStore((s) => s.openLightbox);

  // The clicked item may sit older than the media pages held so far (opened
  // from a chat message the user had scrolled back to); page until it's here.
  useEffect(() => {
    if (activeId === null) return;
    void ensureContains(convId, activeId);
  }, [convId, activeId, ensureContains]);

  const playable = useMemo(
    () => media.filter((m) => viewable(m)),
    [media],
  );
  const idx = useMemo(
    () => playable.findIndex((m) => m.id === activeId),
    [playable, activeId],
  );
  const current: Message | null = idx >= 0 ? playable[idx] : null;

  // "Older" is toward index 0. At the start of what's loaded there may still
  // be more behind it, so fetch a page and then step into it.
  const canPrev = idx > 0 || (idx >= 0 && hasMore);
  const goPrev = useCallback(() => {
    if (idx > 0) {
      open(playable[idx - 1].id);
      return;
    }
    if (idx !== 0 || !hasMore || loadingOlder) return;
    const anchor = playable[0]?.id;
    void loadOlder(convId).then(() => {
      const next = useConvMediaStore.getState().byConv[convId] ?? [];
      const live = next.filter((m) => viewable(m));
      const at = live.findIndex((m) => m.id === anchor);
      if (at > 0) open(live[at - 1].id);
    });
  }, [idx, playable, open, hasMore, loadingOlder, loadOlder, convId]);

  const canNext = idx >= 0 && idx < playable.length - 1;
  const goNext = useCallback(() => {
    if (canNext) open(playable[idx + 1].id);
  }, [canNext, idx, playable, open]);

  const {
    rotation,
    rotateLeft,
    rotateRight,
    scale,
    zoomed,
    zoomIn,
    zoomOut,
    resetView,
    stageRef,
    mediaRef,
    mediaStyle,
    rotationStyle,
    mediaHandlers,
  } = useViewerTransform(current?.id);

  useEffect(() => {
    if (activeId === null) return;
    const onKey = (e: KeyboardEvent) => {
      // While fullscreen, let Esc exit fullscreen instead of closing the viewer.
      if (e.key === "Escape") {
        if (document.fullscreenElement) return;
        close();
      } else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "+" || e.key === "=") zoomIn();
      else if (e.key === "-" || e.key === "_") zoomOut();
      else if (e.key === "0") resetView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, close, goPrev, goNext, zoomIn, zoomOut, resetView]);

  const playedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!current) return;
    if (current.media?.kind === "video" && !playedRef.current.has(current.id)) {
      playedRef.current.add(current.id);
      void registerPlay(current.id);
    }
  }, [current, registerPlay]);

  // Must run unconditionally (before the early return) — an empty url is a no-op.
  const url = current?.media && lib ? mediaSrc(lib, current.media.id) : "";
  const image = useDisplayableImageUrl(url, current?.media?.ext ?? "");

  if (activeId === null) return null;

  if (!current || !current.media) {
    // Still paging back to the clicked item, or it has gone away (deleted, or
    // its volume went offline).
    if (!mediaLoading && !loadingOlder) return null;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
        onClick={close}
      >
        <Loader2 size={28} className="animate-spin text-white/70" />
      </div>
    );
  }

  const isImage = isImageMedia(current.media);

  return (
    <div
      ref={stageRef}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/90"
      onClick={close}
    >
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        {zoomed && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              resetView();
            }}
            className="flex h-10 items-center rounded-full bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/20"
            title="恢复适应窗口 (0)"
          >
            {Math.round(scale * 100)}% · 重置
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            rotateLeft();
          }}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          title="向左旋转"
        >
          <RotateCcw size={18} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            rotateRight();
          }}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          title="向右旋转"
        >
          <RotateCw size={18} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            close();
          }}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          title="关闭 (Esc)"
        >
          <X size={20} />
        </button>
      </div>

      {canPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          className="absolute left-4 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          title="上一个 (←)"
        >
          {loadingOlder && idx === 0 ? (
            <Loader2 size={20} className="animate-spin" />
          ) : (
            <ChevronLeft size={24} />
          )}
        </button>
      )}
      {canNext && (
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
        className="flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {isImage ? (
          image.status === "error" ? (
            <div className="rounded-lg border border-dashed border-white/30 px-6 py-8 text-sm text-white/70">
              此格式无法预览
            </div>
          ) : image.status === "loading" || !image.url ? (
            <Loader2 size={28} className="animate-spin text-white/70" />
          ) : (
            <img
              ref={mediaRef}
              src={image.url}
              alt={current.caption ?? ""}
              className="object-contain"
              style={mediaStyle}
              draggable={false}
              {...mediaHandlers}
            />
          )
        ) : (
          <RotatableVideo
            src={url}
            autoPlay
            style={rotationStyle}
            rotation={rotation}
          />
        )}
        {/* Always rendered: hiding it while zoomed would change the image's
            layout box mid-gesture and throw off the cursor anchoring. */}
        {current.caption && (
          <div className="max-w-2xl text-center text-sm text-white/80">
            {current.caption}
          </div>
        )}
      </div>
    </div>
  );
}
