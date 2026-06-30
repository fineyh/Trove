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
import { mediaUrl } from "../../ipc/client";
import { isHeicPath } from "../../lib/heic";
import { useDisplayableImageUrl } from "../../lib/useDisplayableImageUrl";
import { useRotation } from "../../lib/useRotation";
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

  const goPrev = useCallback(() => {
    if (index > 0) onIndexChange(index - 1);
  }, [index, onIndexChange]);
  const goNext = useCallback(() => {
    if (index < items.length - 1) onIndexChange(index + 1);
  }, [index, items.length, onIndexChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While fullscreen, let Esc exit fullscreen instead of closing the viewer.
      if (e.key === "Escape") {
        if (document.fullscreenElement) return;
        onClose();
      } else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  // Must run unconditionally (before the early return) — empty path is a no-op.
  const absolutePath = current?.absolutePath ?? "";
  const image = useDisplayableImageUrl(absolutePath, mediaUrl(absolutePath));
  const { rotateLeft, rotateRight, mediaStyle } = useRotation(index);

  if (!current) return null;

  const url = mediaUrl(current.absolutePath);
  const isImage =
    current.kind === "image" || isHeicPath(current.absolutePath);
  const canPreview = current.available && current.absolutePath !== "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
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
        className="flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {!canPreview ? (
          <div className="rounded-lg border border-dashed border-white/30 px-6 py-8 text-sm text-white/70">
            文件暂时不可用（来源未挂载）
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
              src={image.url}
              alt=""
              className="object-contain"
              style={mediaStyle}
            />
          )
        ) : (
          <RotatableVideo src={url} autoPlay style={mediaStyle} />
        )}
      </div>
    </div>
  );
}
