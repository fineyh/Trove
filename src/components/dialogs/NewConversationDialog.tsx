import { FolderInput, FolderSync, MessageSquarePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useConversationsStore } from "../../stores/conversations";
import { useSessionStore } from "../../stores/session";
import { isTauri } from "../../hooks/useIsTauri";
import { cn } from "../../lib/cn";
import { errText } from "../../lib/errors";
import { ImportProgressBar } from "../ui/ImportProgressBar";
import { Button } from "../ui/Button";
import { TextField, inputClass } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { Notice } from "../ui/Notice";
import { FileStack } from "../ui/DropOverlay";
import { describeDrop, singleFolder, useFileDropStore } from "../../stores/fileDrop";
import { deliverFiles } from "../../lib/fileDrop";

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

/** The folder the files sit in, as a name for their conversation. */
function parentName(path: string): string {
  const segs = path.split(/[\\/]/).filter(Boolean);
  const parent = segs.length > 1 ? segs[segs.length - 2] : "";
  return /^[A-Za-z]:$/.test(parent) ? "" : parent;
}

type Mode = "manual" | "folder_bulk" | "folder_watch";

const MODES: { value: Mode; icon: React.ReactNode; title: string; desc: string }[] = [
  { value: "manual", icon: <MessageSquarePlus size={18} />, title: "空白会话", desc: "之后再添加内容" },
  { value: "folder_bulk", icon: <FolderInput size={18} />, title: "导入文件夹", desc: "导入文件夹中的图片、视频、录音" },
  { value: "folder_watch", icon: <FolderSync size={18} />, title: "同步文件夹", desc: "随文件夹的增删自动更新" },
];

export function NewConversationDialog() {
  const open = useSessionStore((s) => s.newConversationOpen);
  const setOpen = useSessionStore((s) => s.setNewConversationOpen);
  const setActive = useSessionStore((s) => s.setActiveConversation);
  const createManual = useConversationsStore((s) => s.createManual);
  const createManualFromFolder = useConversationsStore((s) => s.createManualFromFolder);
  const createFolderWatch = useConversationsStore((s) => s.createFolderWatch);
  // Files dragged or pasted in with no conversation to go to.
  const pending = useFileDropStore((s) => s.pending);
  const setPending = useFileDropStore((s) => s.setPending);
  const droppedFolder = pending ? singleFolder(pending) : null;
  const droppedFiles = pending && !droppedFolder ? pending : null;

  const [mode, setMode] = useState<Mode>("manual");
  const [name, setName] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A dropped folder fills in the folder modes; loose files make a plain
  // conversation named after the folder they came from.
  useEffect(() => {
    if (!open || !pending) return;
    const folder = singleFolder(pending);
    if (folder) {
      setMode("folder_bulk");
      setSourcePath(folder);
      setName(baseName(folder));
    } else {
      setMode("manual");
      setName(parentName(pending.paths[0] ?? ""));
    }
  }, [open, pending]);

  const close = () => {
    setPending(null);
    setMode("manual");
    setName("");
    setSourcePath("");
    setError(null);
    setBusy(false);
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
  const canSubmit = !busy && name.trim().length > 0 && (!needsFolder || sourcePath.length > 0);

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
        id = (await createManualFromFolder(sourcePath, trimmedName)).convId;
      } else {
        id = await createManual(trimmedName);
      }
      setActive(id);
      const files = droppedFiles;
      close();
      // Import with the conversation already open, so its own progress bar shows.
      if (files) void deliverFiles({ zone: "pane", kind: "conv", convId: id }, files);
    } catch (e: unknown) {
      setError(errText(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="新建会话"
      footer={
        <>
          <Button onClick={close}>取消</Button>
          <Button variant="primary" disabled={!canSubmit} loading={busy} onClick={submit}>
            创建
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {droppedFiles ? (
          <div className="flex items-center gap-3.5 rounded-xl border border-app-border px-3.5 py-3">
            <FileStack files={droppedFiles} small />
            <span className="text-sm">{describeDrop(droppedFiles)}</span>
          </div>
        ) : (
        <div role="radiogroup" className="divide-y divide-app-border overflow-hidden rounded-xl border border-app-border">
          {MODES.map((m) => {
            const on = m.value === mode;
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setMode(m.value)}
                className={cn(
                  "flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors duration-fast",
                  on ? "bg-app-accent/[0.06]" : "hover:bg-app-hover/[0.03]",
                )}
              >
                <span className={cn("shrink-0", on ? "text-app-accent" : "text-app-secondary")}>{m.icon}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium">{m.title}</span>
                  <span className="text-xs text-app-muted">{m.desc}</span>
                </span>
                <span
                  className={cn(
                    "h-4 w-4 shrink-0 rounded-full border transition-colors duration-fast",
                    on ? "border-[5px] border-app-accent" : "border-app-fg/25",
                  )}
                />
              </button>
            );
          })}
        </div>
        )}

        {needsFolder && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-app-secondary">文件夹</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
                placeholder="D:\Photos\2024"
                className={inputClass}
              />
              <Button onClick={pickFolder}>选择…</Button>
            </div>
          </label>
        )}

        <TextField label="名称" value={name} autoFocus maxLength={60} onChange={(e) => setName(e.target.value)} />

        {error && <Notice tone="danger">{error}</Notice>}
        <div className="-mx-5 empty:hidden">
          <ImportProgressBar />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
