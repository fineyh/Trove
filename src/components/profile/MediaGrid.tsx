import { useEffect, useMemo, useState } from "react";
import { CloudOff, ImageOff, Loader2, Play } from "lucide-react";
import type { Message } from "../../types";
import { mediaSrc, openMedia } from "../../ipc/client";
import { EMPTY_MEDIA, useConvMediaStore } from "../../stores/convMedia";
import { useLibrariesStore } from "../../stores/libraries";
import { useSessionStore } from "../../stores/session";
import { useThumbUrl } from "../../stores/thumbs";
import { toast } from "../../stores/toast";
import { Button } from "../ui/Button";
import { Segmented } from "../ui/Segmented";
import { cn } from "../../lib/cn";
import { isHeicExt } from "../../lib/heic";
import { formatDuration, isImageMedia } from "../../lib/media";

/** Grid click: view what can be viewed, explain what can't. */
function openItem(m: Message, view: (id: number) => void) {
  const media = m.media!;
  if (media.status === "offline") {
    toast.info("文件所在的盘没有连接", "连接后就能打开。");
    return;
  }
  if (media.kind === "other" && !isImageMedia(media)) {
    const lib = useLibrariesStore.getState().current;
    if (lib) void openMedia(lib, media.id).catch((e) => toast.error("打开失败", e));
    return;
  }
  view(m.id);
}

type Tab = "all" | "image" | "video" | "other";

interface MediaGridProps {
  convId: number;
}

/**
 * The profile drawer's media grid. Pages over the conversation's own media
 * sequence (`stores/convMedia`) rather than the chat's loaded slice — it used
 * to render "the media inside the newest 60 messages", which in a folder
 * conversation with thousands of files looked indistinguishable from "this is
 * everything".
 */
export function MediaGrid({ convId }: MediaGridProps) {
  const [tab, setTab] = useState<Tab>("all");
  const open = useSessionStore((s) => s.openLightbox);

  const media = useConvMediaStore((s) => s.byConv[convId]) ?? EMPTY_MEDIA;
  const loading = useConvMediaStore((s) => s.loading[convId] === true);
  const loadingOlder = useConvMediaStore((s) => s.loadingOlder[convId] === true);
  const hasMore = useConvMediaStore((s) => s.hasMore[convId] === true);
  const ensureLoaded = useConvMediaStore((s) => s.ensureLoaded);
  const loadOlder = useConvMediaStore((s) => s.loadOlder);

  useEffect(() => {
    void ensureLoaded(convId);
  }, [convId, ensureLoaded]);

  // Newest first: a grid reads top-down, the opposite of a chat.
  // The kind filter is applied to what's loaded, so switching to "视频" in a
  // photo-heavy conversation may need a few more pages before it fills.
  const items = useMemo(
    () =>
      media
        .filter((m) => m.media)
        .filter((m) => {
          if (tab === "all") return true;
          const img = isImageMedia(m.media!);
          if (tab === "image") return img;
          if (tab === "video") return m.media!.kind === "video";
          return !img && m.media!.kind !== "video";
        })
        .slice()
        .reverse(),
    [media, tab],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pb-3">
        <Segmented
          className="w-full"
          value={tab}
          onChange={setTab}
          options={[
            { value: "all", label: "全部" },
            { value: "image", label: "照片" },
            { value: "video", label: "视频" },
            { value: "other", label: "文件" },
          ]}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading && media.length === 0 ? (
          <div className="flex justify-center py-12 text-app-muted">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-xs text-app-muted">没有内容</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1">
              {items.map((m) => (
                <GridItem key={m.id} message={m} onOpen={() => openItem(m, open)} />
              ))}
            </div>
            {hasMore && (
              <div className="pt-3 text-center">
                <Button size="sm" variant="ghost" onClick={() => void loadOlder(convId)} loading={loadingOlder}>
                  加载更多
                </Button>
              </div>
            )}
          </>
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
  const lib = useLibrariesStore((st) => st.current);
  const media = message.media!;
  const thumb = useThumbUrl(lib, media);
  const isImage = isImageMedia(media);
  const [failed, setFailed] = useState(false);
  // Before its thumbnail exists, a plain image can show the original.
  const fallback =
    !thumb && isImage && !isHeicExt(media.ext) && lib && media.status === "ok"
      ? mediaSrc(lib, media.id)
      : null;
  const src = thumb ?? fallback;
  const offline = media.status === "offline";
  const missing = media.status === "missing";

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={missing}
      data-tip={offline ? "离线" : missing ? "缺失" : undefined}
      className="relative aspect-square overflow-hidden rounded-md bg-app-subtle"
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-fast hover:opacity-90",
            (offline || missing) && "opacity-60 grayscale",
          )}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-app-muted">
          {missing || failed ? <ImageOff size={18} /> : offline ? <CloudOff size={18} /> : media.kind === "video" ? <Play size={18} /> : <Loader2 size={16} className="animate-spin" />}
        </span>
      )}
      {media.kind === "video" && src && !failed && (
        <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-black/50 px-1 text-2xs font-medium text-white">
          <Play size={8} fill="currentColor" />
          {media.durationMs ? formatDuration(media.durationMs) : ""}
        </span>
      )}
      {(offline || missing) && (
        <span className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white">
          {offline ? <CloudOff size={10} /> : <ImageOff size={10} />}
        </span>
      )}
    </button>
  );
}
