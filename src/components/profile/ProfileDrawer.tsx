import { ArrowRightLeft, ImagePlus, MoreHorizontal, Pencil, Pin, PinOff, X } from "lucide-react";
import { useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useConversationsStore } from "../../stores/conversations";
import { useLibrariesStore } from "../../stores/libraries";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import { Button, IconButton } from "../ui/Button";
import { ContextMenu } from "../ui/ContextMenu";
import { ConvAvatar } from "../ui/ConvAvatar";
import { TextField } from "../ui/Field";
import { Modal, useEscapeLayer } from "../ui/Modal";
import { MediaGrid } from "./MediaGrid";

/** Conversation info, docked to the right of the chat. */
export function ProfileDrawer() {
  const open = useSessionStore((s) => s.profileDrawerOpen);
  const setOpen = useSessionStore((s) => s.setProfileDrawerOpen);
  const activeId = useSessionStore((s) => s.activeConversationId);
  const conv = useConversationsStore((s) => (activeId ? (s.list.find((c) => c.id === activeId) ?? null) : null));
  const rename = useConversationsStore((s) => s.rename);
  const togglePinned = useConversationsStore((s) => s.togglePinned);
  const setAvatar = useConversationsStore((s) => s.setAvatar);
  const setMoving = useSessionStore((s) => s.setMovingConversation);
  const libraryCount = useLibrariesStore((s) => s.list.length);

  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);

  useEscapeLayer(open && conv !== null && renaming === null, () => setOpen(false));

  if (!open || !conv) return null;

  const openMenu = () => {
    const rect = moreBtnRef.current?.getBoundingClientRect();
    if (rect) setMenu({ x: rect.left, y: rect.bottom + 4 });
  };

  const submitRename = async () => {
    const next = (renaming ?? "").trim();
    if (!next || next === conv.name) {
      setRenaming(null);
      return;
    }
    setRenameBusy(true);
    try {
      await rename(conv.id, next);
      setRenaming(null);
    } catch (e) {
      toast.error("重命名失败", e);
    } finally {
      setRenameBusy(false);
    }
  };

  return (
    <>
      <aside className="flex h-full w-[320px] shrink-0 animate-slide-in-right flex-col border-l border-app-border bg-app-panel">
        <header className="flex h-[52px] shrink-0 items-center gap-1 pl-4 pr-2.5">
          <span className="flex-1 text-sm font-semibold">会话信息</span>
          <IconButton ref={moreBtnRef} label="更多" size="sm" icon={<MoreHorizontal size={16} />} onClick={openMenu} />
          <IconButton label="关闭" size="sm" icon={<X size={16} />} onClick={() => setOpen(false)} />
        </header>

        <div className="flex flex-col items-center gap-2 px-4 pb-5 pt-3 text-center">
          <ConvAvatar conv={conv} size={64} />
          <div className="mt-1 flex max-w-full flex-col">
            <span className="truncate text-base font-semibold">{conv.name}</span>
            <span className="text-xs text-app-muted">
              {conv.kind === "folder_watch" ? "同步文件夹 · " : ""}
              {conv.messageCount.toLocaleString()} 条
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <MediaGrid convId={conv.id} />
        </div>
      </aside>

      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
        items={[
          {
            label: "重命名",
            icon: <Pencil size={15} />,
            onClick: () => {
              setMenu(null);
              setRenaming(conv.name);
            },
          },
          {
            label: "更换头像…",
            icon: <ImagePlus size={15} />,
            onClick: () => {
              setMenu(null);
              void openFileDialog({
                multiple: false,
                filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp"] }],
              })
                .then((p) => (typeof p === "string" ? setAvatar(conv.id, p) : undefined))
                .catch((e) => toast.error("更换头像失败", e));
            },
          },
          {
            label: conv.pinned ? "取消置顶" : "置顶",
            icon: conv.pinned ? <PinOff size={15} /> : <Pin size={15} />,
            onClick: () => {
              setMenu(null);
              void togglePinned(conv.id, !conv.pinned).catch((e) => toast.error("置顶失败", e));
            },
          },
          "separator",
          {
            label: "移到其他库…",
            icon: <ArrowRightLeft size={15} />,
            disabled: libraryCount < 2,
            onClick: () => {
              setMenu(null);
              setMoving(conv.id);
            },
          },
        ]}
      />

      <Modal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        busy={renameBusy}
        width="sm"
        title="重命名"
        footer={
          <>
            <Button onClick={() => setRenaming(null)} disabled={renameBusy}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => void submitRename()}
              loading={renameBusy}
              disabled={!renaming?.trim() || renaming.trim() === conv.name}
            >
              保存
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitRename();
          }}
        >
          <TextField
            value={renaming ?? ""}
            autoFocus
            maxLength={60}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setRenaming(e.target.value)}
          />
        </form>
      </Modal>
    </>
  );
}
