import { Paperclip, Send } from "lucide-react";
import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useMessagesStore } from "../../stores/messages";
import { isTauri } from "../../hooks/useIsTauri";

interface ComposerProps {
  convId: number;
  disabled?: boolean;
  disabledReason?: string;
}

export function Composer({ convId, disabled, disabledReason }: ComposerProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const sendText = useMessagesStore((s) => s.sendText);
  const importFiles = useMessagesStore((s) => s.importFiles);

  const handleSend = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await sendText(convId, value);
      setText("");
    } catch (e) {
      console.error("send_text failed", e);
    } finally {
      setBusy(false);
    }
  };

  const handlePick = async () => {
    if (!isTauri()) {
      console.warn("file picker requires Tauri runtime");
      return;
    }
    try {
      const picked = await openDialog({
        multiple: true,
        filters: [
          {
            name: "媒体",
            extensions: [
              "jpg",
              "jpeg",
              "png",
              "gif",
              "webp",
              "heic",
              "mp4",
              "mov",
              "webm",
              "mkv",
              "m4v",
            ],
          },
          { name: "全部", extensions: ["*"] },
        ],
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      if (paths.length === 0) return;
      setBusy(true);
      await importFiles(convId, paths);
    } catch (e) {
      console.error("import_files failed", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-end gap-2 border-t border-app-border bg-app-panel px-3 py-2">
      <button
        type="button"
        title={disabled ? disabledReason : "上传文件"}
        onClick={handlePick}
        disabled={disabled || busy}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-app-fg/70 hover:bg-app-subtle hover:text-app-fg disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Paperclip size={18} />
      </button>
      <textarea
        rows={1}
        placeholder={disabled ? (disabledReason ?? "") : "输入消息..."}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
          }
        }}
        disabled={disabled || busy}
        className="max-h-32 min-h-9 flex-1 resize-none rounded-md border border-transparent bg-app-subtle px-3 py-2 text-sm outline-none focus:border-app-accent/40 focus:bg-app-panel disabled:cursor-not-allowed disabled:opacity-60"
      />
      <button
        type="button"
        title="发送"
        onClick={handleSend}
        disabled={disabled || busy || text.trim() === ""}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-app-accent text-white hover:opacity-90 disabled:opacity-40"
      >
        <Send size={16} />
      </button>
    </div>
  );
}
