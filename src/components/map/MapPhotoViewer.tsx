import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquare,
  RotateCcw,
  RotateCw,
  X,
} from "lucide-react";
import { useCallback, useEffect } from "react";
import type { GeotaggedMedia } from "../../types";
import { mediaSrc, thumbSrc } from "../../ipc/client";
import { useLibrariesStore } from "../../stores/libraries";
import { isImageMedia } from "../../lib/media";
import { useDisplayableImageUrl } from "../../lib/useDisplayableImageUrl";
import { useViewerTransform } from "../../lib/useViewerTransform";
import { RotatableVideo } from "../ui/RotatableVideo";

interface MapPhotoViewerProps {
  items: GeotaggedMedia[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onJump: (item: GeotaggedMedia) => void;
}

/**
 * Fullscreen viewer for the photos at one map location. Mirrors `Lightbox`'s
 * interaction skeleton but is sourced from a cross-conversation
 * `GeotaggedMedia[]` instead of a single conversation's message store.
 */
export function MapPhotoViewer({
  items,
  index,
  onClose,
  onIndexChange,
  onJump,
}: MapPhotoViewerProps) {
  const current = items[index] ?? null;
  const lib = useLibrariesStore((s) => s.current) ?? "";

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
  } = useViewerTransform(index);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While fullscreen, let Esc exit fullscreen instead of closing the viewer.
      if (e.key === "Escape") {
        if (document.fullscreenElement) return;
        onClose();
      } else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "+" || e.key === "=") zoomIn();
      else if (e.key === "-" || e.key === "_") zoomOut();
      else if (e.key === "0") resetView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext, zoomIn, zoomOut, resetView]);

  const canPreview = current?.status === "ok";
  // Must run unconditionally (before the early return) — an empty url is a no-op.
  const url = current && lib && canPreview ? mediaSrc(lib, current.mediaId) : "";
  const image = useDisplayableImageUrl(url, current?.ext ?? "");

  if (!current) return null;

  const isImage = isImageMedia(current);
  // Offline: the stored thumbnail is still something to look at.
  const offlineThumb = !canPreview && current.hasThumb && lib ? thumbSrc(lib, current.mediaId) : null;

  return (
    <div
      ref={stageRef}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/90"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onJump(current);
        }}
        className="absolute left-4 top-4 z-10 flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20"
        title="在会话中打开"
      >
        <MessageSquare size={16} />
        在会话中打开
      </button>

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
            onClose();
          }}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          title="关闭 (Esc)"
        >
          <X size={20} />
        </button>
      </div>

      {index > 0 && (
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
      {index < items.length - 1 && (
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
        {!canPreview ? (
          <div className="flex flex-col items-center gap-3">
            {offlineThumb && (
              <img src={offlineThumb} alt="" className="max-h-[50vh] rounded-xl opacity-80" draggable={false} />
            )}
            <div className="rounded-full bg-white/10 px-4 py-1.5 text-sm text-white/80">
              {current.status === "offline" ? "所在的盘没有连接，这是缩略图" : "文件不在原位置"}
            </div>
          </div>
        ) : isImage ? (
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
              alt=""
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
      </div>
    </div>
  );
}
