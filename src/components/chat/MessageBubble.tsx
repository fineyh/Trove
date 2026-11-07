import { useEffect, useRef, useState } from "react";
import {
  CloudOff,
  Copy,
  ExternalLink,
  File as FileIcon,
  FolderSearch,
  ImageOff,
  PictureInPicture2,
  Play,
  Trash2,
  UserSquare2,
} from "lucide-react";
import type { Message } from "../../types";
import * as ipc from "../../ipc/client";
import { useSessionStore } from "../../stores/session";
import { useMessagesStore } from "../../stores/messages";
import { useConversationsStore } from "../../stores/conversations";
import { useLibrariesStore } from "../../stores/libraries";
import { useThumbUrl } from "../../stores/thumbs";
import { toast } from "../../stores/toast";
import { ContextMenu, type ContextMenuEntry } from "../ui/ContextMenu";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { openPlayerWindow } from "../../lib/playerWindow";
import { formatBytes, formatDuration, isImageMedia, kindLabel } from "../../lib/media";
import { cn } from "../../lib/cn";

/** Longest side of a single preview, CSS px. Matches the stored thumbnail. */
const PREVIEW_MAX = 320;
const PREVIEW_MIN = 120;

/** Fixed-height tile inside an album row; width follows the aspect ratio. */
export interface TileSize {
  height: number;
}

interface MessageBubbleProps {
  message: Message;
  tile?: TileSize;
}

function formatPlayCount(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Box for a preview from known dimensions; 4:3 when unknown. */
function previewBox(w: number | null, h: number | null, tile?: TileSize): React.CSSProperties {
  if (tile) {
    const ratio = w && h ? w / h : 4 / 3;
    return { height: tile.height, width: Math.round(Math.min(Math.max(tile.height * ratio, 96), tile.height * 2)) };
  }
  if (!w || !h) return { width: 240, aspectRatio: "4 / 3" };
  const s = Math.min(1, PREVIEW_MAX / Math.max(w, h));
  return { width: Math.max(PREVIEW_MIN, Math.round(w * s)), aspectRatio: `${w} / ${h}` };
}

/** Hairline that keeps white photos from melting into the background. */
const MEDIA_FRAME = "rounded-lg bg-app-subtle ring-1 ring-inset ring-black/[0.06] dark:ring-white/[0.06]";

function useLib(): string | null {
  return useLibrariesStore((s) => s.current);
}

function Shimmer() {
  return (
    <div className="h-full w-full animate-shimmer bg-[linear-gradient(90deg,rgb(var(--fill))_0%,rgb(var(--line)/0.6)_50%,rgb(var(--fill))_100%)] bg-[length:200%_100%]" />
  );
}

function ImageMessage({ message, tile }: MessageBubbleProps) {
  const lib = useLib();
  const open = useSessionStore((s) => s.openLightbox);
  const media = message.media!;
  const thumb = useThumbUrl(lib, media);
  const [failed, setFailed] = useState(false);
  // No thumbnail yet: plain formats can show the original meanwhile; HEIC
  // waits for the worker (decoding it here would double the work).
  const fallback = !thumb && media.ext !== "heic" && media.ext !== "heif" && lib ? ipc.mediaSrc(lib, media.id) : null;
  const src = thumb ?? fallback;

  return (
    <button
      type="button"
      onClick={() => open(message.id)}
      className={cn("relative block overflow-hidden", MEDIA_FRAME)}
      style={previewBox(media.width, media.height, tile)}
    >
      {failed ? (
        <span className="flex h-full w-full items-center justify-center text-app-muted">
          <ImageOff size={20} />
        </span>
      ) : src ? (
        <img
          src={src}
          alt={message.caption ?? ""}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <Shimmer />
      )}
    </button>
  );
}

function VideoMessage({ message, tile }: MessageBubbleProps) {
  const lib = useLib();
  const ref = useRef<HTMLVideoElement | null>(null);
  const open = useSessionStore((s) => s.openLightbox);
  const lightboxOpen = useSessionStore((s) => s.lightboxMessageId !== null);
  const media = message.media!;
  const poster = useThumbUrl(lib, media);
  const [playing, setPlaying] = useState(false);

  // Muted preview loops while the bubble is on screen. `preload="none"` plus
  // the poster means nothing is fetched until it actually scrolls into view.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !lightboxOpen) {
            void el.play().catch(() => {});
          } else {
            el.pause();
          }
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [lightboxOpen]);

  return (
    <button
      type="button"
      onClick={() => open(message.id)}
      className="relative block overflow-hidden rounded-lg bg-black"
      style={previewBox(media.width, media.height, tile)}
    >
      {lib && (
        <video
          ref={ref}
          src={ipc.mediaSrc(lib, media.id)}
          poster={poster ?? undefined}
          muted
          loop
          playsInline
          preload="none"
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className="h-full w-full object-cover"
        />
      )}
      {!playing && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white">
            <Play size={16} fill="currentColor" className="ml-0.5" />
          </span>
        </span>
      )}
      <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1.5 rounded-md bg-black/50 px-1.5 text-2xs font-medium leading-[18px] text-white">
        {media.durationMs ? formatDuration(media.durationMs) : "视频"}
        {message.playCount > 0 && (
          <span className="flex items-center gap-0.5 opacity-80">
            <Play size={8} fill="currentColor" />
            {formatPlayCount(message.playCount)}
          </span>
        )}
      </span>
    </button>
  );
}

/** A file-like card: icon tile, one title line, one meta line. */
function Card({
  icon,
  title,
  meta,
  onClick,
  tone = "default",
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  meta: React.ReactNode;
  onClick?: () => void;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-64 items-center gap-3 rounded-xl border bg-app-panel p-2.5 pr-3.5 text-left transition-colors duration-fast hover:bg-app-hover/[0.03]",
        tone === "danger" ? "border-dashed border-app-danger/40" : "border-app-border",
      )}
    >
      <span
        className={cn(
          "relative flex h-11 w-11 shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg",
          tone === "warning" && "bg-app-warning/10 text-app-warning",
          tone === "danger" && "bg-app-danger/10 text-app-danger",
          tone === "default" && "bg-app-accent/10 text-app-accent",
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="truncate text-xs text-app-muted">{meta}</span>
      </span>
    </button>
  );
}

/** Disk not connected: still shows what it is (thumbnail), just can't open. */
function OfflineMedia({ message, tile }: MessageBubbleProps) {
  const lib = useLib();
  const media = message.media!;
  const thumb = useThumbUrl(lib, media);
  const notify = () => toast.info("文件所在的磁盘未连接");

  if (!thumb) {
    return <Card tone="warning" icon={<CloudOff size={18} />} title={message.caption ?? kindLabel(media)} meta="离线 · 磁盘未连接" onClick={notify} />;
  }
  return (
    <button
      type="button"
      onClick={notify}
      className={cn("relative block overflow-hidden", MEDIA_FRAME)}
      style={previewBox(media.width, media.height, tile)}
    >
      <img src={thumb} alt="" draggable={false} className="h-full w-full object-cover opacity-60 grayscale-[40%]" />
      <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-md bg-black/55 px-1.5 text-2xs font-medium leading-[18px] text-white">
        <CloudOff size={10} />
        离线
      </span>
    </button>
  );
}

/** Disk connected, file gone: never hidden, always points at the fix. */
function MissingMedia({ message }: MessageBubbleProps) {
  const lib = useLib();
  const media = message.media!;
  const thumb = useThumbUrl(lib, media);
  const openSettings = useSessionStore((s) => s.setSettingsOpen);
  return (
    <Card
      tone="danger"
      icon={thumb ? <img src={thumb} alt="" className="h-full w-full object-cover opacity-50 grayscale" draggable={false} /> : <ImageOff size={18} />}
      title={message.caption ?? kindLabel(media)}
      meta={<span>缺失 · <span className="text-app-accent">重新链接</span></span>}
      onClick={() => openSettings(true, "storage")}
    />
  );
}

function FileMessage({ message }: MessageBubbleProps) {
  const lib = useLib();
  const media = message.media!;
  return (
    <Card
      icon={
        <>
          <FileIcon size={16} />
          {media.ext && <span className="mt-0.5 text-[8px] font-bold uppercase leading-none">{media.ext.slice(0, 4)}</span>}
        </>
      }
      title={message.caption ?? "文件"}
      meta={formatBytes(media.sizeBytes)}
      onClick={() => lib && void ipc.openMedia(lib, media.id).catch((e) => toast.error("打开失败", e))}
    />
  );
}

function TextMessage({ message }: MessageBubbleProps) {
  return (
    <div className="selectable max-w-[min(480px,100%)] whitespace-pre-wrap break-words rounded-xl bg-app-accent/10 px-3 py-[7px] text-sm leading-[22px] text-app-fg dark:bg-app-accent/[0.16]">
      {message.caption}
    </div>
  );
}

/** Image or offline-with-thumbnail: can sit in an album row. */
export function isTileable(m: Message): boolean {
  const media = m.media;
  if (!media) return false;
  if (media.status === "missing") return false;
  if (media.status === "offline") return media.hasThumb && isImageMedia(media);
  return isImageMedia(media);
}

export function MessageBubble({ message, tile }: MessageBubbleProps) {
  const lib = useLib();
  const remove = useMessagesStore((s) => s.remove);
  // Synced-folder conversations mirror a live folder: deleting a message
  // record alone is futile (a rescan re-adds the file), so they don't offer
  // it. Missing files are cleaned up from the missing-files dialog instead.
  const isFolderWatch = useConversationsStore(
    (s) => s.list.find((c) => c.id === message.convId)?.kind === "folder_watch",
  );
  const setAvatar = useConversationsStore((s) => s.setAvatar);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteFile, setDeleteFile] = useState(false);
  const [busy, setBusy] = useState(false);

  const media = message.media;
  const reachable = media?.status === "ok";
  const isImage = media != null && isImageMedia(media);
  const isVideo = media?.kind === "video";

  let body: React.ReactNode;
  if (!media) body = <TextMessage message={message} />;
  else if (media.status === "offline") body = <OfflineMedia message={message} tile={tile} />;
  else if (media.status === "missing") body = <MissingMedia message={message} />;
  else if (isImage) body = <ImageMessage message={message} tile={tile} />;
  else if (isVideo) body = <VideoMessage message={message} tile={tile} />;
  else body = <FileMessage message={message} />;

  const openConfirm = () => {
    setMenu(null);
    setDeleteFile(false);
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await remove(message.id, message.convId, reachable && deleteFile);
      setConfirmOpen(false);
    } catch (err) {
      toast.error("删除失败", err);
    } finally {
      setBusy(false);
    }
  };

  const act = (fn: () => Promise<unknown>, failText: string) => () => {
    setMenu(null);
    void fn().catch((e) => toast.error(failText, e));
  };

  const menuItems: ContextMenuEntry[] = [];
  if (!media && message.caption) {
    menuItems.push({
      label: "复制",
      icon: <Copy size={15} />,
      onClick: act(() => navigator.clipboard.writeText(message.caption ?? ""), "复制失败"),
    });
  }
  if (media && lib) {
    if (reachable && (isVideo || isImage)) {
      menuItems.push({
        label: "在新窗口打开",
        icon: <PictureInPicture2 size={15} />,
        onClick: act(() => openPlayerWindow(message), "打开窗口失败"),
      });
    }
    menuItems.push(
      {
        label: "用默认应用打开",
        icon: <ExternalLink size={15} />,
        disabled: !reachable,
        onClick: act(() => ipc.openMedia(lib, media.id), "打开失败"),
      },
      {
        label: "在资源管理器中显示",
        icon: <FolderSearch size={15} />,
        disabled: !reachable,
        onClick: act(() => ipc.revealMedia(lib, media.id), "打开文件夹失败"),
      },
      "separator",
      {
        label: "复制文件路径",
        icon: <Copy size={15} />,
        onClick: act(async () => {
          const p = await ipc.mediaPathForCopy(lib, media.id);
          await navigator.clipboard.writeText(p);
          toast.success("已复制路径");
        }, "复制失败"),
      },
    );
    if (isImage || isVideo) {
      menuItems.push({
        label: "设为会话头像",
        icon: <UserSquare2 size={15} />,
        onClick: act(async () => {
          await setAvatar(message.convId, `media:${media.id}`);
          toast.success("已设为会话头像");
        }, "设置头像失败"),
      });
    }
  }
  if (!isFolderWatch) {
    menuItems.push("separator", {
      label: "删除",
      variant: "danger",
      icon: <Trash2 size={15} />,
      onClick: openConfirm,
    });
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    // Selected text keeps the system copy menu.
    if (!media && window.getSelection()?.toString()) return;
    e.preventDefault();
    if (menuItems.length === 0) return;
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div className={cn(tile ? "shrink-0" : "flex")} onContextMenu={handleContextMenu}>
        {body}
      </div>

      <ContextMenu open={menu !== null} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={() => setMenu(null)} items={menuItems} />

      <ConfirmDialog
        open={confirmOpen}
        title="删除消息"
        variant="danger"
        confirmText="删除"
        busy={busy}
        onConfirm={handleConfirm}
        onCancel={() => {
          if (!busy) setConfirmOpen(false);
        }}
        message={
          <div className="flex flex-col gap-3">
            <p>{reachable ? "磁盘上的文件默认保留。" : "只删除这条消息。"}</p>
            {reachable && (
              <label className="flex items-center gap-2 text-sm text-app-fg">
                <input
                  type="checkbox"
                  checked={deleteFile}
                  onChange={(e) => setDeleteFile(e.target.checked)}
                  className="h-4 w-4 accent-[rgb(var(--danger))]"
                />
                同时把文件移到回收站
              </label>
            )}
          </div>
        }
      />
    </>
  );
}
