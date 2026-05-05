import { Folder, FolderInput, Lock, MessageSquare, X } from "lucide-react";
import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useConversationsStore } from "../../stores/conversations";
import { useSessionStore } from "../../stores/session";
import { isTauri } from "../../hooks/useIsTauri";
import { cn } from "../../lib/cn";
import * as ipc from "../../ipc/client";

type Mode = "manual" | "folder_bulk" | "folder_watch";

export function NewConversationDialog() {
  const open = useSessionStore((s) => s.newConversationOpen);
  const setOpen = useSessionStore((s) => s.setNewConversationOpen);
  const setActive = useSessionStore((s) => s.setActiveConversation);
  const createManual = useConversationsStore((s) => s.createManual);
  const createManualFromFolder = useConversationsStore(
    (s) => s.createManualFromFolder,
  );
  const createFolderWatch = useConversationsStore((s) => s.createFolderWatch);

  const [mode, setMode] = useState<Mode>("manual");
  const [name, setName] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [busy, setBusy] = useState(false);
  const [encrypt, setEncrypt] = useState(false);
  const [convPassword, setConvPassword] = useState("");
  const [convPasswordConfirm, setConvPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setMode("manual");
    setName("");
    setSourcePath("");
    setEncrypt(false);
    setConvPassword("");
    setConvPasswordConfirm("");
    setError(null);
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

  const needsFolder = mode === "folder_bulk" || mode === "folder_watch";
  const canEncrypt = mode !== "folder_watch"; // watcher needs to write while locked
  const passwordOk =
    !encrypt ||
    (convPassword.length >= 4 && convPassword === convPasswordConfirm);
  const canSubmit =
    !busy &&
    name.trim().length > 0 &&
    (!needsFolder || sourcePath.length > 0) &&
    passwordOk;

  const submit = async () => {
    if (!canSubmit) return;
    const trimmedName = name.trim();
    setError(null);
    setBusy(true);
    try {
      let id: number;
      if (mode === "folder_watch") {
        id = await createFolderWatch(trimmedName, sourcePath);
      } else if (mode === "folder_bulk") {
        if (encrypt) {
          throw new Error("文件夹批量导入暂不支持加密会话");
        }
        const result = await createManualFromFolder(sourcePath, trimmedName);
        id = result.convId;
      } else if (encrypt) {
        id = await ipc.createConversation({
          name: trimmedName,
          kind: "manual",
          encrypt: true,
          password: convPassword,
        });
        await useConversationsStore.getState().refresh();
      } else {
        id = await createManual(trimmedName);
      }
      setActive(id);
      close();
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      console.error("create_conversation failed", e);
      setError(m);
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

        <div className="flex flex-col gap-2">
          <ModeRow
            active={mode === "manual"}
            onClick={() => setMode("manual")}
            icon={<MessageSquare size={18} />}
            title="手动会话"
            desc="空会话，自己上传文件"
          />
          <ModeRow
            active={mode === "folder_bulk"}
            onClick={() => setMode("folder_bulk")}
            icon={<FolderInput size={18} />}
            title="从文件夹批量创建"
            desc="一次性导入文件夹里的全部媒体（之后仍可继续上传）"
          />
          <ModeRow
            active={mode === "folder_watch"}
            onClick={() => setMode("folder_watch")}
            icon={<Folder size={18} />}
            title="路径会话"
            desc="绑定文件夹自动同步，新增/删除即时生效"
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

        {needsFolder && (
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
              {mode === "folder_bulk"
                ? "导入文件夹里的所有图片和视频，文件保留在原位置。"
                : "文件夹内的媒体会自动出现在对话里，路径会话不支持手动上传。"}
            </div>
          </div>
        )}

        {canEncrypt && (
          <label className="flex items-start gap-2 rounded-md border border-app-border p-2.5 text-xs">
            <input
              type="checkbox"
              checked={encrypt}
              onChange={(e) => setEncrypt(e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1 font-medium text-app-fg">
                <Lock size={11} />
                加密会话
              </span>
              <span className="text-app-muted">
                每次进入需输入会话密码；caption 与文件名都会以 AES-GCM 加密。
              </span>
            </div>
          </label>
        )}

        {encrypt && canEncrypt && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-app-muted">会话密码</label>
              <input
                type="password"
                value={convPassword}
                onChange={(e) => setConvPassword(e.target.value)}
                className="rounded-md border border-app-border bg-app-subtle px-3 py-2 text-sm outline-none focus:border-app-accent/60 focus:bg-app-panel"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-app-muted">再次输入</label>
              <input
                type="password"
                value={convPasswordConfirm}
                onChange={(e) => setConvPasswordConfirm(e.target.value)}
                className="rounded-md border border-app-border bg-app-subtle px-3 py-2 text-sm outline-none focus:border-app-accent/60 focus:bg-app-panel"
              />
            </div>
            {convPassword.length > 0 && convPassword.length < 4 && (
              <div className="text-xs text-red-500">密码至少 4 位</div>
            )}
            {convPasswordConfirm.length > 0 &&
              convPassword !== convPasswordConfirm && (
                <div className="text-xs text-red-500">两次输入不一致</div>
              )}
          </div>
        )}

        {error && <div className="text-xs text-red-500">{error}</div>}

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
            disabled={!canSubmit}
            onClick={submit}
            className="rounded-md bg-app-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "创建中..." : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ModeRowProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}

function ModeRow({ active, onClick, icon, title, desc }: ModeRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-md border p-3 text-left transition",
        active
          ? "border-app-accent bg-app-accent/5"
          : "border-app-border hover:bg-app-subtle",
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-app-accent/10 text-app-accent">
        {icon}
      </div>
      <div className="flex min-w-0 flex-col">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-app-muted">{desc}</div>
      </div>
    </button>
  );
}
