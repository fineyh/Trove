import { Folder, MessageSquare, X } from "lucide-react";
import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useConversationsStore } from "../../stores/conversations";
import { useSessionStore } from "../../stores/session";
import { isTauri } from "../../hooks/useIsTauri";
import { cn } from "../../lib/cn";

type Mode = "manual" | "folder_watch";

export function NewConversationDialog() {
  const open = useSessionStore((s) => s.newConversationOpen);
  const setOpen = useSessionStore((s) => s.setNewConversationOpen);
  const setActive = useSessionStore((s) => s.setActiveConversation);
  const createManual = useConversationsStore((s) => s.createManual);
  const createFolderWatch = useConversationsStore((s) => s.createFolderWatch);

  const [mode, setMode] = useState<Mode>("manual");
  const [name, setName] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const reset = () => {
    setMode("manual");
    setName("");
    setSourcePath("");
    setBusy(false);
  };

  const close = () => {
    reset();
    setOpen(false);
  };

  const pickFolder = async () => {
    if (!isTauri()) return;
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") {
      setSourcePath(picked);
      if (!name) {
        const seg = picked.split(/[\\/]/).filter(Boolean).pop();
        if (seg) setName(seg);
      }
    }
  };

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setBusy(true);
    try {
      let id: number;
      if (mode === "folder_watch") {
        if (!sourcePath) {
          setBusy(false);
          return;
        }
        id = await createFolderWatch(trimmedName, sourcePath);
      } else {
        id = await createManual(trimmedName);
      }
      setActive(id);
      close();
    } catch (e) {
      console.error("create_conversation failed", e);
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      onClick={close}
    >
      <div
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-app-border bg-app-panel p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold">新建会话</div>
          <button
            type="button"
            onClick={close}
            className="flex h-7 w-7 items-center justify-center rounded text-app-muted hover:bg-app-subtle"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ModeCard
            active={mode === "manual"}
            onClick={() => setMode("manual")}
            icon={<MessageSquare size={18} />}
            title="手动会话"
            desc="空会话，自己上传文件"
          />
          <ModeCard
            active={mode === "folder_watch"}
            onClick={() => setMode("folder_watch")}
            icon={<Folder size={18} />}
            title="路径会话"
            desc="绑定文件夹自动同步"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-app-muted">名称</label>
          <input
            type="text"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：我的旅行"
            className="rounded-md border border-app-border bg-app-subtle px-3 py-2 text-sm outline-none focus:border-app-accent/60 focus:bg-app-panel"
          />
        </div>

        {mode === "folder_watch" && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-app-muted">文件夹路径</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
                placeholder="选择或粘贴路径"
                className="flex-1 rounded-md border border-app-border bg-app-subtle px-3 py-2 text-sm outline-none focus:border-app-accent/60 focus:bg-app-panel"
              />
              <button
                type="button"
                onClick={pickFolder}
                className="rounded-md border border-app-border px-3 text-sm hover:bg-app-subtle"
              >
                浏览...
              </button>
            </div>
            <div className="text-xs text-app-muted">
              文件夹内的媒体会自动出现在对话里，路径会话不支持手动上传。
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-app-border px-3 py-1.5 text-sm hover:bg-app-subtle"
          >
            取消
          </button>
          <button
            type="button"
            disabled={
              busy ||
              !name.trim() ||
              (mode === "folder_watch" && !sourcePath)
            }
            onClick={submit}
            className="rounded-md bg-app-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-40"
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

interface ModeCardProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}

function ModeCard({ active, onClick, icon, title, desc }: ModeCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1 rounded-md border p-3 text-left transition",
        active
          ? "border-app-accent bg-app-accent/5"
          : "border-app-border hover:bg-app-subtle",
      )}
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-app-accent/10 text-app-accent">
        {icon}
      </div>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-app-muted">{desc}</div>
    </button>
  );
}
