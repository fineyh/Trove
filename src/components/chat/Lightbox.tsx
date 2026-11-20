import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Message } from "../../types";
import { mediaSrc, thumbSrc } from "../../ipc/client";
import { useLibrariesStore } from "../../stores/libraries";
import { EMPTY_MEDIA, useConvMediaStore } from "../../stores/convMedia";
import { INFO_PANEL_WIDTH, useInfoPanelStore } from "../../stores/infoPanel";
import { useSessionStore } from "../../stores/session";
import { isImageMedia } from "../../lib/media";
import { previewStyle, useDisplayableImageUrl } from "../../lib/useDisplayableImageUrl";
import { useViewerTransform } from "../../lib/useViewerTransform";
import { useViewTracker } from "../../lib/viewTracker";
import { RotatableVideo } from "../ui/RotatableVideo";
import { useEscapeLayer } from "../ui/Modal";
import { InfoPanel } from "../info/InfoPanel";
import { ViewerBar, viewerKey } from "../info/ViewerBar";
import { MessageMenu, type MessageMenuTarget } from "./MessageMenu";

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

  const activeId = useSessionStore((s) => s.lightboxMessageId);
  const close = useSessionStore((s) => s.closeLightbox);
  const lib = useLibrariesStore((s) => s.current) ?? "";
  const open = useSessionStore((s) => s.openLightbox);
  const panelOpen = useInfoPanelStore((s) => s.open);
  const togglePanel = useInfoPanelStore((s) => s.toggle);
  const [menu, setMenu] = useState<MessageMenuTarget | null>(null);

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
    percent,
    zoomed,
    zoomIn,
    zoomOut,
    resetView,
    stageRef,
    mediaRef,
    mediaStyle,
    mediaHandlers,
  } = useViewerTransform(current?.id, { inset: panelOpen ? INFO_PANEL_WIDTH : 0 });

  // Topmost layer while open: Esc closes the viewer, not the info panel
  // behind it. While fullscreen, Esc only leaves fullscreen.
  useEscapeLayer(activeId !== null, () => {
    if (!document.fullscreenElement) close();
  });

  useEffect(() => {
    if (activeId === null) return;
    const onKey = (e: KeyboardEvent) => {
      const key = viewerKey(e);
      if (key === "ArrowLeft") goPrev();
      else if (key === "ArrowRight") goNext();
      else if (key === "+" || key === "=") zoomIn();
      else if (key === "-" || key === "_") zoomOut();
      else if (key === "0") resetView();
      else if (key === "i" || key === "I") togglePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, goPrev, goNext, zoomIn, zoomOut, resetView, togglePanel]);

  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  useViewTracker(
    lib,
    current?.id ?? null,
    current?.media?.kind === "video" ? "video" : "image",
    "viewer",
    videoEl,
  );

  // Must run unconditionally (before the early return) — an empty url is a no-op.
  const url = current?.media && lib ? mediaSrc(lib, current.media.id) : "";
  const thumb = current?.media?.hasThumb && lib ? thumbSrc(lib, current.media.id) : null;
  const image = useDisplayableImageUrl(url, current?.media?.ext ?? "", thumb);

  if (activeId === null) return null;

  if (!current || !current.media) {
    // Still paging back to the clicked item, or it has gone away (deleted, or
    // its volume went offline).
    if (!mediaLoading && !loadingOlder) return null;
    return (
      <div
        data-immersive
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
        onClick={close}
      >
        <Loader2 size={28} className="animate-spin text-white/70" />
      </div>
    );
  }

  const isImage = isImageMedia(current.media);
  // After a delete from the menu: the next item, else the one before, else out.
  const neighbour = playable[idx + 1]?.id ?? playable[idx - 1]?.id ?? null;
  const caption = current.caption?.trim();

  return (
    <div data-immersive className="dark fixed inset-0 z-50 flex bg-black/90 text-app-fg">
      <div className="flex min-w-0 flex-1 flex-col" onClick={close}>
        <ViewerBar
          when={{ takenAt: current.media.takenAt, takenOffset: current.media.takenOffset, createdAt: current.createdAt }}
          percent={percent}
          zoomed={zoomed}
          onResetZoom={resetView}
          onRotateLeft={rotateLeft}
          onRotateRight={rotateRight}
          onMore={(r) => setMenu({ x: r.right - 180, y: r.bottom + 4, message: current })}
          onClose={close}
        />

        <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          {canPrev && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goPrev();
              }}
              className="absolute left-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-fast hover:bg-white/20"
              data-tip="上一个  ←"
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
              className="absolute right-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-fast hover:bg-white/20"
              data-tip="下一个  →"
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
                  无法预览此格式
                </div>
              ) : image.status === "loading" || !image.url ? (
                <Loader2 size={28} className="animate-spin text-white/70" />
              ) : (
                <img
                  ref={mediaRef}
                  src={image.url}
                  alt={caption ?? ""}
                  className="object-contain"
                  style={image.preview ? previewStyle(mediaStyle) : mediaStyle}
                  onLoad={image.onLoad}
                  draggable={false}
                  {...mediaHandlers}
                />
              )
            ) : (
              <RotatableVideo
                src={url}
                autoPlay
                style={mediaStyle}
                rotation={rotation}
                onVideo={setVideoEl}
                frameRef={mediaRef}
                onFramePointerDown={mediaHandlers.onPointerDown}
              />
            )}
            {/* What the user wrote travels with the picture; with the panel
                open it's there instead. It only changes with the panel, never
                mid-gesture, so the zoom anchoring isn't thrown off. */}
            {!panelOpen && caption && (
              <div className="selectable line-clamp-2 max-w-2xl px-6 text-center text-sm leading-[22px] text-white/80">
                {caption}
              </div>
            )}
          </div>
        </div>
      </div>

      {panelOpen && <InfoPanel lib={lib} message={current} place="viewer" />}

      <MessageMenu
        menu={menu}
        onClose={() => setMenu(null)}
        inViewer
        onDeleted={() => (neighbour !== null ? open(neighbour) : close())}
      />
    </div>
  );
}
