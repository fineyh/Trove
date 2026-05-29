import { useEffect, useRef, useState } from "react";
import { ImageOff, Play, Trash2 } from "lucide-react";
import type { Message } from "../../types";
import { mediaUrl } from "../../ipc/client";
import { useSessionStore } from "../../stores/session";
import { useMessagesStore } from "../../stores/messages";
import { useConversationsStore } from "../../stores/conversations";
import { ContextMenu } from "../ui/ContextMenu";
import { ConfirmDialog } from "../ui/ConfirmDialog";

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
  const lightboxOpen = useSessionStore((s) => s.lightboxMessageId !== null);
  const url = mediaUrl(message.media!.absolutePath);

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
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [lightboxOpen]);

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

function BrokenMediaPlaceholder({ message }: MessageBubbleProps) {
  const kindLabel =
    message.media!.kind === "image"
      ? "图片"
      : message.media!.kind === "video"
        ? "视频"
        : "文件";
  return (
    <div className="flex max-w-md items-center gap-3 rounded-lg border border-dashed border-app-border bg-app-subtle/40 px-3 py-3 text-sm text-app-muted">
      <ImageOff size={20} />
      <div className="flex flex-col">
        <span className="font-medium text-app-fg/70">
          {kindLabel}文件暂时不可用
        </span>
        <span className="text-xs">
          所在卷未挂载或文件已被移走
        </span>
      </div>
    </div>
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
  const remove = useMessagesStore((s) => s.remove);
  // folder_watch ("路径") conversations mirror a live folder — deleting a
  // message record alone is futile (a rescan/watcher event re-adds the file),
  // so the chat view disables message deletion for them. Broken-pointer
  // cleanup still happens via BrokenManagerDialog (a separate path).
  const isFolderWatch = useConversationsStore(
    (s) => s.list.find((c) => c.id === message.convId)?.kind === "folder_watch",
  );
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteFile, setDeleteFile] = useState(false);
  const [busy, setBusy] = useState(false);

  // The original file can only be sent to the recycle bin when the media is
  // backed by a reachable (live) file. Broken media is unreachable → message
  // record only.
  const canDeleteFile =
    message.media != null && message.media.state === "live";

  const time = new Date(message.createdAt).toLocaleString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  let body: React.ReactNode;
  if (message.media?.state === "broken")
    body = <BrokenMediaPlaceholder message={message} />;
  else if (message.media?.kind === "image") body = <ImageMessage message={message} />;
  else if (message.media?.kind === "video") body = <VideoMessage message={message} />;
  else if (message.media) body = <FileMessage message={message} />;
  else body = <TextMessage message={message} />;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isFolderWatch) return; // 路径会话不提供删除
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const openConfirm = () => {
    setMenu(null);
    setDeleteFile(false);
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await remove(message.id, message.convId, canDeleteFile && deleteFile);
      setConfirmOpen(false);
    } catch (err) {
      console.error("delete message failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1" onContextMenu={handleContextMenu}>
        {body}
        {message.media && message.caption && (
          <div className="max-w-md text-sm text-app-fg/80">{message.caption}</div>
        )}
        <div className="text-[11px] text-app-muted">{time}</div>
      </div>

      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
        items={[
          {
            label: "删除消息",
            variant: "danger",
            icon: <Trash2 size={14} />,
            onClick: openConfirm,
          },
        ]}
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
              {canDeleteFile
                ? "默认只删除这条消息，不会动磁盘上的原文件。"
                : message.media
                  ? "原文件当前不可用，将只删除这条消息记录。"
                  : "确定删除这条消息吗？此操作无法撤销。"}
            </p>
            {canDeleteFile && (
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
