import { ArrowRightLeft, ImagePlus, MoreHorizontal, Pencil, Pin, PinOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useConversationsStore } from "../../stores/conversations";
import { useLibrariesStore } from "../../stores/libraries";
import { ConvAvatar } from "../ui/ConvAvatar";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import { ContextMenu } from "../ui/ContextMenu";
import { MediaGrid } from "./MediaGrid";

export function ProfileDrawer() {
  const open = useSessionStore((s) => s.profileDrawerOpen);
  const setOpen = useSessionStore((s) => s.setProfileDrawerOpen);
  const activeId = useSessionStore((s) => s.activeConversationId);
  const conv = useConversationsStore((s) =>
    activeId ? s.list.find((c) => c.id === activeId) ?? null : null,
  );
  const rename = useConversationsStore((s) => s.rename);
  const togglePinned = useConversationsStore((s) => s.togglePinned);
  const setAvatar = useConversationsStore((s) => s.setAvatar);
  const setMoving = useSessionStore((s) => s.setMovingConversation);
  const libraryCount = useLibrariesStore((s) => s.list.length);

  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  if (!open || !conv) return null;

  const close = () => setOpen(false);

  const openMenu = () => {
    const rect = moreBtnRef.current?.getBoundingClientRect();
    if (rect) setMenu({ x: rect.right, y: rect.bottom + 4 });
  };

  const startRename = () => {
    setMenu(null);
    setDraftName(conv.name);
    setRenaming(true);
  };

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/30" onClick={close} />
      <aside className="fixed right-0 top-0 z-40 flex h-full w-96 animate-pop-in flex-col border-l border-app-border bg-app-panel shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-app-border px-4 py-3">
          <ConvAvatar conv={conv} size={40} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{conv.name}</div>
            <div className="text-xs text-app-muted">
              {conv.messageCount} 条消息 ·{" "}
              {conv.kind === "folder_watch" ? "路径会话" : "手动会话"}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              ref={moreBtnRef}
              type="button"
              onClick={openMenu}
              title="更多"
              className="flex h-8 w-8 items-center justify-center rounded text-app-muted hover:bg-app-subtle"
            >
              <MoreHorizontal size={16} />
            </button>
            <button
              type="button"
              onClick={close}
              className="flex h-8 w-8 items-center justify-center rounded text-app-muted hover:bg-app-subtle"
            >
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-hidden">
          <MediaGrid convId={conv.id} />
        </div>
      </aside>

      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={[
          {
            label: conv.pinned ? "取消置顶" : "置顶会话",
            icon: conv.pinned ? <PinOff size={14} /> : <Pin size={14} />,
            onClick: () => {
              void togglePinned(conv.id, !conv.pinned);
              setMenu(null);
            },
          },
          {
            label: "修改会话名",
            icon: <Pencil size={14} />,
            onClick: startRename,
          },
          {
            label: "更换头像…",
            icon: <ImagePlus size={14} />,
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
            label: "移到其他库…",
            icon: <ArrowRightLeft size={14} />,
            disabled: libraryCount < 2,
            onClick: () => {
              setMenu(null);
              setMoving(conv.id);
            },
          },
        ]}
        onClose={() => setMenu(null)}
      />

      {renaming && (
        <RenameDialog
          initialName={conv.name}
          value={draftName}
          busy={renameBusy}
          onChange={setDraftName}
          onCancel={() => {
            if (!renameBusy) setRenaming(false);
          }}
          onConfirm={async () => {
            const next = draftName.trim();
            if (next.length === 0 || next === conv.name) {
              setRenaming(false);
              return;
            }
            setRenameBusy(true);
            try {
              await rename(conv.id, next);
              setRenaming(false);
            } catch (e) {
              toast.error("修改会话名失败", e);
            } finally {
              setRenameBusy(false);
            }
          }}
        />
      )}
    </>
  );
}

interface RenameDialogProps {
  initialName: string;
  value: string;
  busy: boolean;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function RenameDialog({
  initialName,
  value,
  busy,
  onChange,
  onConfirm,
  onCancel,
}: RenameDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const trimmed = value.trim();
  const canSubmit = !busy && trimmed.length > 0 && trimmed !== initialName;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-app-border bg-app-panel p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold">修改会话名</div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex h-7 w-7 items-center justify-center rounded text-app-muted hover:bg-app-subtle disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-app-muted">名称</label>
          <input
            type="text"
            value={value}
            autoFocus
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) onConfirm();
            }}
            className="rounded-md border border-app-border bg-app-subtle px-3 py-2 text-sm outline-none focus:border-app-accent/60 focus:bg-app-panel"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-app-border px-3 py-1.5 text-sm hover:bg-app-subtle disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canSubmit}
            className="rounded-md bg-app-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
