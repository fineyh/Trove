import { useMemo, useState } from "react";
import { ImageOff, Loader2, Play } from "lucide-react";
import type { Message } from "../../types";
import { mediaUrl } from "../../ipc/client";
import { useSessionStore } from "../../stores/session";
import { cn } from "../../lib/cn";
import { isHeicPath } from "../../lib/heic";
import { useDisplayableImageUrl } from "../../lib/useDisplayableImageUrl";

type Tab = "all" | "image" | "video" | "other";

interface MediaGridProps {
  messages: readonly Message[];
}

export function MediaGrid({ messages }: MediaGridProps) {
  const [tab, setTab] = useState<Tab>("all");
  const open = useSessionStore((s) => s.openLightbox);

  const items = useMemo(
    () =>
      messages
        .filter((m) => m.media)
        .filter((m) =>
          tab === "all" ? true : m.media!.kind === tab,
        ),
    [messages, tab],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-app-border px-3 pt-2">
        {(["all", "image", "video", "other"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-2 text-sm",
              tab === t
                ? "border-b-2 border-app-accent text-app-fg"
                : "text-app-muted hover:text-app-fg",
            )}
          >
            {t === "all" ? "全部" : t === "image" ? "图片" : t === "video" ? "视频" : "其他"}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {items.length === 0 ? (
          <div className="py-12 text-center text-sm text-app-muted">
            暂无内容
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {items.map((m) => (
              <GridItem key={m.id} message={m} onOpen={() => open(m.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GridItem({
  message,
  onOpen,
}: {
  message: Message;
  onOpen: () => void;
}) {
  const absolutePath = message.media!.absolutePath;
  // Treat HEIC/HEIF as image regardless of stored `kind` (mime_guess may have
  // tagged older rows "other"); decode it to a displayable blob URL.
  const isImage =
    message.media!.kind === "image" || isHeicPath(absolutePath);
  // Hook must run unconditionally (before the broken early-return). For videos
  // the path isn't HEIC so it resolves to the asset URL immediately and unused.
  const image = useDisplayableImageUrl(absolutePath, mediaUrl(absolutePath));

  if (message.media!.state === "broken") {
    return (
      <div
        title="文件暂时不可用"
        className="flex aspect-square items-center justify-center rounded-md border border-dashed border-app-border bg-app-subtle/40 text-app-muted"
      >
        <ImageOff size={20} />
      </div>
    );
  }
  const url = mediaUrl(absolutePath);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative aspect-square overflow-hidden rounded-md bg-black/5"
    >
      {isImage ? (
        image.status === "error" ? (
          <span className="flex h-full w-full items-center justify-center text-app-muted">
            <ImageOff size={20} />
          </span>
        ) : image.status === "loading" || !image.url ? (
          <span className="flex h-full w-full items-center justify-center bg-app-subtle/40 text-app-muted">
            <Loader2 size={18} className="animate-spin" />
          </span>
        ) : (
          <img src={image.url} className="h-full w-full object-cover" alt="" />
        )
      ) : (
        <>
          <video
            src={url}
            preload="metadata"
            muted
            className="h-full w-full object-cover"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white">
            <Play size={20} fill="currentColor" />
          </span>
        </>
      )}
    </button>
  );
}
