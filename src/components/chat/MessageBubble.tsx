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
  Wrench,
} from "lucide-react";
import type { Message } from "../../types";
import * as ipc from "../../ipc/client";
import { useSessionStore } from "../../stores/session";
import { useMessagesStore } from "../../stores/messages";
import { useConversationsStore } from "../../stores/conversations";
import { useLibrariesStore } from "../../stores/libraries";
import { useThumbUrl } from "../../stores/thumbs";
import { toast } from "../../stores/toast";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { openPlayerWindow } from "../../lib/playerWindow";
import { formatFullDateTime, formatMessageTime } from "../../lib/datetime";
import { formatBytes, formatDuration, isImageMedia, kindLabel } from "../../lib/media";
import { cn } from "../../lib/cn";

interface MessageBubbleProps {
  message: Message;
}

/** Longest side of a chat preview, CSS px. Matches the stored thumbnail. */
const PREVIEW_MAX = 320;

function formatPlayCount(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Box size for a preview, from known dimensions; square-ish fallback. */
function previewBox(w: number | null, h: number | null): React.CSSProperties {
  if (!w || !h) return { width: 240, aspectRatio: "4 / 3" };
  const s = Math.min(1, PREVIEW_MAX / Math.max(w, h));
  return { width: Math.max(120, Math.round(w * s)), aspectRatio: `${w} / ${h}` };
}

function useLib(): string | null {
  return useLibrariesStore((s) => s.current);
}

function Shimmer() {
  return (
    <div className="h-full w-full animate-shimmer bg-[linear-gradient(90deg,rgb(var(--fill))_0%,rgb(var(--line)/0.6)_50%,rgb(var(--fill))_100%)] bg-[length:200%_100%]" />
  );
}

function ImageMessage({ message }: MessageBubbleProps) {
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
      className="group relative block overflow-hidden rounded-2xl border border-app-border bg-app-subtle shadow-sm"
      style={previewBox(media.width, media.height)}
    >
      {failed ? (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-xs text-app-muted">
          <ImageOff size={20} />
          无法预览，点开查看
        </span>
      ) : src ? (
        <img
          src={src}
          alt={message.caption ?? ""}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <Shimmer />
      )}
    </button>
  );
}

function VideoMessage({ message }: MessageBubbleProps) {
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
      className="group relative block overflow-hidden rounded-2xl border border-app-border bg-black shadow-sm"
      style={previewBox(media.width, media.height)}
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
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition group-hover:scale-110">
            <Play size={18} fill="currentColor" className="ml-0.5" />
          </span>
        </span>
      )}
      <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
        {media.durationMs ? formatDuration(media.durationMs) : "视频"}
      </span>
      {message.playCount > 0 && (
        <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white backdrop-blur-sm">
          <Play size={9} fill="currentColor" />
          {formatPlayCount(message.playCount)}
        </span>
      )}
    </button>
  );
}

/** Volume not mounted: still shows what it is (thumbnail), just can't open. */
function OfflineMedia({ message }: MessageBubbleProps) {
  const lib = useLib();
  const media = message.media!;
  const thumb = useThumbUrl(lib, media);
  const notify = () =>
    toast.info("文件所在的盘没有连接", "连接那块盘（或打开对应的加密盘）后就能打开。");

  if (!thumb) {
    return (
      <button
        type="button"
        onClick={notify}
        className="flex w-64 items-center gap-3 rounded-2xl border border-app-border bg-app-panel px-3.5 py-3 text-left shadow-sm"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
          <CloudOff size={18} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{kindLabel(media)} · 离线</span>
          <span className="text-xs text-app-muted">所在的盘没有连接</span>
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={notify}
      className="relative block overflow-hidden rounded-2xl border border-app-border bg-app-subtle shadow-sm"
      style={previewBox(media.width, media.height)}
    >
      <img src={thumb} alt="" draggable={false} className="h-full w-full object-cover opacity-70 grayscale-[35%]" />
      <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
        <CloudOff size={11} />
        离线
      </span>
    </button>
  );
}

/** Volume mounted, file gone: never hidden, always points at the fix. */
function MissingMedia({ message }: MessageBubbleProps) {
  const lib = useLib();
  const media = message.media!;
  const thumb = useThumbUrl(lib, media);
  const openSettings = useSessionStore((s) => s.setSettingsOpen);
  return (
    <div className="flex w-72 items-center gap-3 rounded-2xl border border-dashed border-red-500/40 bg-red-500/[0.04] p-2.5 pr-3">
      <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-app-subtle text-app-muted">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover opacity-50 grayscale" draggable={false} />
        ) : (
          <ImageOff size={18} />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{kindLabel(media)}不在原位置</span>
        <span className="text-xs text-app-muted">可能被移动、改名或删除了</span>
      </span>
      <button
        type="button"
        onClick={() => openSettings(true, "media")}
        className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-app-accent transition hover:bg-app-accent/10"
      >
        <Wrench size={12} />
        修复
      </button>
    </div>
  );
}

function FileMessage({ message }: MessageBubbleProps) {
  const lib = useLib();
  const media = message.media!;
  const openFile = () => {
    if (lib) void ipc.openMedia(lib, media.id).catch((e) => toast.error("打开失败", e));
  };
  return (
    <button
      type="button"
      onClick={openFile}
      title="用默认应用打开"
      className="flex w-64 items-center gap-3 rounded-2xl border border-app-border bg-app-panel px-3.5 py-3 text-left shadow-sm transition hover:bg-app-subtle"
    >
      <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl bg-app-accent/10 text-app-accent">
        <FileIcon size={16} />
        {media.ext && <span className="mt-0.5 text-[8px] font-bold uppercase leading-none">{media.ext.slice(0, 4)}</span>}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{message.caption ?? "文件"}</span>
        <span className="text-xs text-app-muted">{formatBytes(media.sizeBytes)}</span>
      </span>
    </button>
  );
}

function TextMessage({ message }: MessageBubbleProps) {
  return (
    <div className="max-w-md select-text whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-app-accent px-3.5 py-2 text-sm leading-relaxed text-white shadow-sm">
      {message.caption}
    </div>
  );
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const lib = useLib();
  const remove = useMessagesStore((s) => s.remove);
  // folder_watch ("路径") conversations mirror a live folder — deleting a
  // message record alone is futile (a rescan/watcher event re-adds the file),
  // so the chat view disables message deletion for them. Missing-file
  // cleanup still happens via BrokenManagerDialog (a separate path).
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

  const time = formatMessageTime(message.createdAt);
  const fullTime = formatFullDateTime(message.createdAt);

  let body: React.ReactNode;
  if (!media) body = <TextMessage message={message} />;
  else if (media.status === "offline") body = <OfflineMedia message={message} />;
  else if (media.status === "missing") body = <MissingMedia message={message} />;
  else if (isImage) body = <ImageMessage message={message} />;
  else if (isVideo) body = <VideoMessage message={message} />;
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
      toast.error("删除消息失败", err);
    } finally {
      setBusy(false);
    }
  };

  const act = (fn: () => Promise<unknown>, failText: string) => () => {
    setMenu(null);
    void fn().catch((e) => toast.error(failText, e));
  };

  const menuItems: ContextMenuItem[] = [];
  if (media && lib) {
    if (reachable && (isVideo || isImage)) {
      menuItems.push({
        label: isImage ? "在新窗口打开" : "在新窗口播放",
        icon: <PictureInPicture2 size={14} />,
        onClick: act(() => openPlayerWindow(message), "打开窗口失败"),
      });
    }
    menuItems.push(
      {
        label: "用默认应用打开",
        icon: <ExternalLink size={14} />,
        disabled: !reachable,
        onClick: act(() => ipc.openMedia(lib, media.id), "打开失败"),
      },
      {
        label: "在文件夹中显示",
        icon: <FolderSearch size={14} />,
        disabled: !reachable,
        onClick: act(() => ipc.revealMedia(lib, media.id), "打开文件夹失败"),
      },
      {
        label: "复制文件路径",
        icon: <Copy size={14} />,
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
        icon: <UserSquare2 size={14} />,
        onClick: act(async () => {
          await setAvatar(message.convId, `media:${media.id}`);
          toast.success("已设为会话头像");
        }, "设置头像失败"),
      });
    }
  }
  // folder_watch ("路径") conversations don't offer message deletion.
  if (!isFolderWatch) {
    menuItems.push({
      label: "删除消息",
      variant: "danger",
      icon: <Trash2 size={14} />,
      onClick: openConfirm,
    });
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (menuItems.length === 0) return;
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div className={cn("flex flex-col items-start gap-1")} onContextMenu={handleContextMenu}>
        {body}
        {media && message.caption && media.kind !== "other" && (
          <div className="max-w-xs select-text truncate text-xs text-app-fg/70" title={message.caption}>
            {message.caption}
          </div>
        )}
        <div className="text-[11px] text-app-muted" title={fullTime}>
          {time}
        </div>
      </div>

      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
        items={menuItems}
      />

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
            <p>
              {reachable
                ? "默认只删除这条消息，不会动磁盘上的原文件。"
                : media
                  ? "原文件当前不可用，将只删除这条消息记录。"
                  : "确定删除这条消息吗？此操作无法撤销。"}
            </p>
            {reachable && (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-app-fg/80">
                <input
                  type="checkbox"
                  checked={deleteFile}
                  onChange={(e) => setDeleteFile(e.target.checked)}
                  className="h-4 w-4 accent-red-600"
                />
                同时把原文件移到回收站
              </label>
            )}
          </div>
        }
      />
    </>
  );
}
