import { useEffect, useState } from "react";
import { Copy, ExternalLink, FolderSearch, Heart, HeartOff, Info, PictureInPicture2, Trash2, UserSquare2 } from "lucide-react";
import type { Message } from "../../types";
import * as ipc from "../../ipc/client";
import { useSessionStore } from "../../stores/session";
import { useMessagesStore } from "../../stores/messages";
import { useConversationsStore } from "../../stores/conversations";
import { useLibrariesStore } from "../../stores/libraries";
import { toast } from "../../stores/toast";
import { setFavorite } from "../../stores/favorites";
import { ContextMenu, type ContextMenuEntry } from "../ui/ContextMenu";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { openPlayerWindow } from "../../lib/playerWindow";
import { isImageMedia } from "../../lib/media";

export interface MessageMenuTarget {
  x: number;
  y: number;
  message: Message;
}

interface MessageMenuProps {
  /** Where the menu is open and for which message; null = closed. */
  menu: MessageMenuTarget | null;
  onClose: () => void;
  /** Opened from a viewer's "more" button: the viewer has its own info panel. */
  inViewer?: boolean;
  /** The message was deleted (a viewer moves on to another item). */
  onDeleted?: (message: Message) => void;
  /** Favorited or not from here, for a host holding its own copy. */
  onFavoriteChange?: (mediaId: number, favorite: boolean) => void;
}

/**
 * The right-click menu for one message, shared by the chat stream and the
 * profile drawer's media grid so both offer the same actions. Owns the delete
 * confirmation, which outlives the menu itself.
 */
export function MessageMenu({ menu, onClose, inViewer, onDeleted, onFavoriteChange }: MessageMenuProps) {
  const lib = useLibrariesStore((s) => s.current);
  const remove = useMessagesStore((s) => s.remove);
  const setAvatar = useConversationsStore((s) => s.setAvatar);
  // Synced-folder conversations mirror a live folder: deleting a message
  // record alone is futile (a rescan re-adds the file), so they don't offer
  // it. Missing files are cleaned up from the missing-files dialog instead.
  const convId = menu?.message.convId;
  const isFolderWatch = useConversationsStore(
    (s) => convId != null && s.list.find((c) => c.id === convId)?.kind === "folder_watch",
  );
  const [confirmFor, setConfirmFor] = useState<Message | null>(null);
  const [deleteFile, setDeleteFile] = useState(false);
  const [busy, setBusy] = useState(false);

  const items: ContextMenuEntry[] = [];
  const message = menu?.message;
  const media = message?.media;
  const reachable = media?.status === "ok";
  const isImage = media != null && isImageMedia(media);
  const isVideo = media?.kind === "video";

  const act = (fn: () => Promise<unknown>, failText: string) => () => {
    onClose();
    void fn().catch((e) => toast.error(failText, e));
  };

  if (message && !media && message.caption) {
    items.push({
      label: "复制",
      icon: <Copy size={15} />,
      onClick: act(() => navigator.clipboard.writeText(message.caption ?? ""), "无法复制"),
    });
  }
  if (message && media && lib) {
    // Position, viewing history and the rest are in the info panel (ADR-062).
    if (!inViewer) {
      items.push({
        label: "信息",
        icon: <Info size={15} />,
        onClick: () => {
          onClose();
          useSessionStore.getState().openInfo(message.id);
        },
      });
    }
    // A viewer has its own favorite button.
    if (!inViewer) {
      const on = !media.favorite;
      items.push({
        label: on ? "收藏" : "取消收藏",
        icon: on ? <Heart size={15} /> : <HeartOff size={15} />,
        onClick: act(async () => {
          await setFavorite(lib, media, on);
          onFavoriteChange?.(media.id, on);
        }, on ? "无法收藏" : "无法取消收藏"),
      });
    }
    if (reachable && (isVideo || isImage)) {
      items.push({
        label: "在新窗口打开",
        icon: <PictureInPicture2 size={15} />,
        onClick: act(() => openPlayerWindow(message), "无法打开窗口"),
      });
    }
    items.push("separator",
      {
        label: "用默认应用打开",
        icon: <ExternalLink size={15} />,
        disabled: !reachable,
        onClick: act(() => ipc.openMedia(lib, media.id), "无法打开"),
      },
      {
        label: "在资源管理器中显示",
        icon: <FolderSearch size={15} />,
        disabled: !reachable,
        onClick: act(() => ipc.revealMedia(lib, media.id), "无法打开文件夹"),
      },
      "separator",
      {
        label: "复制文件路径",
        icon: <Copy size={15} />,
        onClick: act(async () => {
          const p = await ipc.mediaPathForCopy(lib, media.id);
          await navigator.clipboard.writeText(p);
          toast.success("已复制路径");
        }, "无法复制"),
      },
    );
    if (isImage || isVideo) {
      items.push({
        label: "设为会话头像",
        icon: <UserSquare2 size={15} />,
        onClick: act(async () => {
          await setAvatar(message.convId, `media:${media.id}`);
          toast.success("已设为会话头像");
        }, "无法设置头像"),
      });
    }
  }
  if (message && !isFolderWatch) {
    items.push("separator", {
      label: "删除",
      variant: "danger",
      icon: <Trash2 size={15} />,
      onClick: () => {
        onClose();
        setDeleteFile(false);
        setConfirmFor(message);
      },
    });
  }

  const empty = menu !== null && items.length === 0;
  useEffect(() => {
    if (empty) onClose();
  }, [empty, onClose]);

  const confirmReachable = confirmFor?.media?.status === "ok";

  const handleConfirm = async () => {
    if (!confirmFor) return;
    setBusy(true);
    try {
      await remove(confirmFor.id, confirmFor.convId, confirmReachable && deleteFile);
      setConfirmFor(null);
      onDeleted?.(confirmFor);
      // The docked info panel was about this one.
      const s = useSessionStore.getState();
      if (s.infoMessageId === confirmFor.id) s.closeInfo();
    } catch (err) {
      toast.error("无法删除", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ContextMenu open={menu !== null && !empty} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={onClose} items={items} />

      <ConfirmDialog
        open={confirmFor !== null}
        title="删除消息"
        variant="danger"
        confirmText="删除"
        busy={busy}
        onConfirm={handleConfirm}
        onCancel={() => {
          if (!busy) setConfirmFor(null);
        }}
        message={
          <div className="flex flex-col gap-3">
            <p>{confirmReachable ? "磁盘上的文件默认保留。" : "将删除这条消息。"}</p>
            {confirmReachable && (
              <label className="flex items-center gap-2 text-sm text-app-fg">
                <input
                  type="checkbox"
                  checked={deleteFile}
                  onChange={(e) => setDeleteFile(e.target.checked)}
                  className="h-4 w-4 accent-[rgb(var(--danger))]"
                />
                同时将文件移到回收站
              </label>
            )}
          </div>
        }
      />
    </>
  );
}
