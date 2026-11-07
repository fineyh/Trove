import { ArrowUp, Plus } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useMessagesStore } from "../../stores/messages";
import { toast } from "../../stores/toast";
import { ImportProgressBar } from "../ui/ImportProgressBar";
import { IconButton } from "../ui/Button";
import { isTauri } from "../../hooks/useIsTauri";
import { cn } from "../../lib/cn";

const MEDIA_EXTENSIONS = [
  "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "bmp", "tif", "tiff", "jfif",
  "mp4", "mov", "webm", "mkv", "m4v", "avi", "ts",
];

/** Taller than this and the text box scrolls. */
const MAX_HEIGHT = 160;

export function Composer({ convId }: { convId: number }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const sendText = useMessagesStore((s) => s.sendText);
  const importFiles = useMessagesStore((s) => s.importFiles);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the text.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  const handleSend = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await sendText(convId, value);
      setText("");
    } catch (e) {
      toast.error("发送失败", e);
    } finally {
      setBusy(false);
      ref.current?.focus();
    }
  };

  const handlePick = async () => {
    if (!isTauri()) return;
    try {
      const picked = await openDialog({
        multiple: true,
        filters: [
          { name: "照片和视频", extensions: MEDIA_EXTENSIONS },
          { name: "所有文件", extensions: ["*"] },
        ],
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      if (paths.length === 0) return;
      setBusy(true);
      await importFiles(convId, paths);
    } catch (e) {
      toast.error("导入失败", e);
    } finally {
      setBusy(false);
    }
  };

  const canSend = text.trim() !== "" && !busy;

  return (
    <div className="shrink-0">
      <ImportProgressBar convId={convId} />
      <div className="px-4 pb-4 pt-1">
        <div className="flex items-end gap-1 rounded-xl border border-app-border bg-app-panel p-1 transition-colors duration-fast focus-within:border-app-accent/60 focus-within:ring-2 focus-within:ring-app-accent/15">
          <IconButton label="添加照片或视频" icon={<Plus size={18} />} onClick={handlePick} disabled={busy} tipSide="top" />
          <textarea
            ref={ref}
            rows={1}
            placeholder="输入文字"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSend();
              }
            }}
            disabled={busy}
            className="min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm leading-5 outline-none placeholder:text-app-muted disabled:opacity-60"
          />
          <button
            type="button"
            aria-label="发送"
            onClick={handleSend}
            disabled={!canSend}
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-fast",
              canSend ? "bg-app-accent text-app-on-accent hover:bg-app-accent/90" : "text-app-muted",
            )}
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
