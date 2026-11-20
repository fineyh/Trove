import { ChevronLeft, ChevronRight, Loader2, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Message, ViewerItem } from "../../types";
import { getMessages, mediaSrc, thumbSrc } from "../../ipc/client";
import { useLibrariesStore } from "../../stores/libraries";
import { toggleFavorite } from "../../stores/favorites";
import { INFO_PANEL_WIDTH, useInfoPanelStore } from "../../stores/infoPanel";
import { isImageMedia } from "../../lib/media";
import { previewStyle, useDisplayableImageUrl } from "../../lib/useDisplayableImageUrl";
import { useViewerTransform } from "../../lib/useViewerTransform";
import { useViewTracker } from "../../lib/viewTracker";
import { RotatableVideo } from "../ui/RotatableVideo";
import { IconButton } from "../ui/Button";
import { useEscapeLayer } from "../ui/Modal";
import { InfoPanel } from "./InfoPanel";
import { ViewerBar, viewerKey } from "./ViewerBar";
import { MessageMenu, type MessageMenuTarget } from "../chat/MessageMenu";

interface ItemsViewerProps {
  items: ViewerItem[];
  index: number;
  /** Which view it is over: the map's viewer sends "show on map" back to it. */
  from: "map" | "favorites";
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onJump: (item: ViewerItem) => void;
  onFavoriteChange?: (mediaId: number, favorite: boolean) => void;
}

/**
 * Fullscreen viewer over items from several conversations (the map's list,
 * the favorites). Mirrors `Lightbox`'s interaction skeleton but is sourced
 * from its own list instead of a single conversation's message store.
 */
export function ItemsViewer({
  items,
  index,
  from,
  onClose,
  onIndexChange,
  onJump,
  onFavoriteChange,
}: ItemsViewerProps) {
  const current = items[index] ?? null;
  const lib = useLibrariesStore((s) => s.current) ?? "";
  const panelOpen = useInfoPanelStore((s) => s.open);
  const togglePanel = useInfoPanelStore((s) => s.toggle);
  const [menu, setMenu] = useState<MessageMenuTarget | null>(null);

  // The map holds positions only; the info panel and the menu want the message.
  const [message, setMessage] = useState<Message | null>(null);
  const messageId = current?.messageId ?? null;
  useEffect(() => {
    setMessage(null);
    if (messageId === null || !lib) return;
    let live = true;
    getMessages(lib, [messageId])
      .then((list) => live && setMessage(list[0] ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [lib, messageId]);

  // The message is this viewer's own copy: keep it in step.
  const flipFavorite = useCallback(() => {
    const m = message?.media;
    if (!m || m.id !== current?.mediaId || !lib) return;
    void toggleFavorite(lib, m).then((on) => {
      if (on === null) return;
      setMessage((x) => (x?.media?.id === m.id ? { ...x, media: { ...x.media, favorite: on } } : x));
      onFavoriteChange?.(m.id, on);
    });
  }, [message, current?.mediaId, lib, onFavoriteChange]);

  const goPrev = useCallback(() => {
    if (index > 0) onIndexChange(index - 1);
  }, [index, onIndexChange]);
  const goNext = useCallback(() => {
    if (index < items.length - 1) onIndexChange(index + 1);
  }, [index, items.length, onIndexChange]);

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
  } = useViewerTransform(index, { inset: panelOpen ? INFO_PANEL_WIDTH : 0 });

  // Topmost layer while open: Esc closes the viewer, not the selection behind
  // it. While fullscreen, Esc only leaves fullscreen.
  useEscapeLayer(true, () => {
    if (!document.fullscreenElement) onClose();
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = viewerKey(e);
      if (key === "ArrowLeft") goPrev();
      else if (key === "ArrowRight") goNext();
      else if (key === "+" || key === "=") zoomIn();
      else if (key === "-" || key === "_") zoomOut();
      else if (key === "0") resetView();
      else if (key === "i" || key === "I") togglePanel();
      else if (key === "f" || key === "F") flipFavorite();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, zoomIn, zoomOut, resetView, togglePanel, flipFavorite]);

  const canPreview = current?.status === "ok";
  // Must run unconditionally (before the early return) — an empty url is a no-op.
  const url = current && lib && canPreview ? mediaSrc(lib, current.mediaId) : "";
  const thumb = current?.hasThumb && lib && canPreview ? thumbSrc(lib, current.mediaId) : null;
  const image = useDisplayableImageUrl(url, current?.ext ?? "", thumb);

  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  useViewTracker(
    lib,
    current && canPreview ? current.messageId : null,
    current?.kind === "video" ? "video" : "image",
    from === "map" ? "map" : "viewer",
    videoEl,
  );

  if (!current) return null;

  const isImage = isImageMedia(current);
  // Offline: the stored thumbnail is still something to look at.
  const offlineThumb = !canPreview && current.hasThumb && lib ? thumbSrc(lib, current.mediaId) : null;
  const shown = message?.media?.id === current.mediaId ? message : null;
  const caption = shown?.caption?.trim();

  return (
    <div data-immersive className="dark fixed inset-0 z-50 flex bg-black/90 text-app-fg">
      <div className="flex min-w-0 flex-1 flex-col" onClick={onClose}>
        <ViewerBar
          when={current}
          percent={percent}
          zoomed={zoomed}
          onResetZoom={resetView}
          onRotateLeft={rotateLeft}
          onRotateRight={rotateRight}
          onMore={shown ? (r) => setMenu({ x: r.right - 180, y: r.bottom + 4, message: shown }) : undefined}
          onClose={onClose}
          favorite={shown?.media?.favorite ?? false}
          onFavorite={shown ? flipFavorite : undefined}
          extra={
            <IconButton
              label="在会话中打开"
              tipSide="bottom"
              icon={<MessageSquare size={18} />}
              onClick={(e) => {
                e.stopPropagation();
                onJump(current);
              }}
            />
          }
        />

        <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          {index > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goPrev();
              }}
              className="absolute left-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-fast hover:bg-white/20"
              data-tip="上一个  ←"
            >
              <ChevronLeft size={24} />
            </button>
          )}
          {index < items.length - 1 && (
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
            {!canPreview ? (
              <div className="flex flex-col items-center gap-3">
                {offlineThumb && (
                  <img src={offlineThumb} alt="" className="max-h-[50vh] rounded-xl opacity-80" draggable={false} />
                )}
                <div className="rounded-full bg-white/10 px-4 py-1.5 text-sm text-white/80">
                  {current.status === "offline" ? "离线" : "缺失"}
                </div>
              </div>
            ) : isImage ? (
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
            {!panelOpen && caption && (
              <div className="selectable line-clamp-2 max-w-2xl px-6 text-center text-sm leading-[22px] text-white/80">
                {caption}
              </div>
            )}
          </div>
        </div>
      </div>

      {panelOpen &&
        (shown ? (
          <InfoPanel
            lib={lib}
            message={shown}
            place="viewer"
            // Already on the map: close the viewer onto this photo.
            onShowOnMap={from === "map" ? onClose : undefined}
            onCaptionSaved={(c) => setMessage((m) => (m ? { ...m, caption: c } : m))}
          />
        ) : (
          <div className="w-[320px] shrink-0 border-l border-app-border bg-app-panel" />
        ))}

      <MessageMenu menu={menu} onClose={() => setMenu(null)} inViewer onDeleted={onClose} />
    </div>
  );
}
