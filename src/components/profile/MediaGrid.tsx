import { useCallback, useEffect, useMemo, useState } from "react";
import { AudioLines, CloudOff, ImageOff, Loader2, Play } from "lucide-react";
import type { Message } from "../../types";
import { mediaSrc, openMedia } from "../../ipc/client";
import { EMPTY_MEDIA, useConvMediaStore } from "../../stores/convMedia";
import { useLibrariesStore } from "../../stores/libraries";
import { useSessionStore } from "../../stores/session";
import { useThumbPending, useThumbUrl } from "../../stores/thumbs";
import { toast } from "../../stores/toast";
import { Button } from "../ui/Button";
import { MessageMenu, type MessageMenuTarget } from "../chat/MessageMenu";
import { Segmented } from "../ui/Segmented";
import { cn } from "../../lib/cn";
import { isHeicExt } from "../../lib/heic";
import { formatDuration, isImageMedia, messageTitle } from "../../lib/media";
import { trackOf, useAudioStore } from "../../stores/audio";

/** Grid click: view what can be viewed, explain what can't. */
function openItem(m: Message, view: (id: number) => void) {
  const media = m.media!;
  if (media.status === "offline") {
    toast.info("文件所在的磁盘未连接");
    return;
  }
  if (media.kind === "audio") {
    const lib = useLibrariesStore.getState().current;
    const t = lib ? trackOf(lib, m) : null;
    if (t) useAudioStore.getState().play(t);
    return;
  }
  if (media.kind === "other" && !isImageMedia(media)) {
    const lib = useLibrariesStore.getState().current;
    if (lib) void openMedia(lib, media.id).catch((e) => toast.error("无法打开", e));
    return;
  }
  view(m.id);
}

type Tab = "all" | "image" | "video" | "audio" | "other";

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
  const [menu, setMenu] = useState<MessageMenuTarget | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

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
          if (tab === "audio") return m.media!.kind === "audio";
          return !img && m.media!.kind === "other";
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
            { value: "image", label: "图片" },
            { value: "video", label: "视频" },
            { value: "audio", label: "录音" },
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
                <GridItem
                  key={m.id}
                  message={m}
                  onOpen={() => openItem(m, open)}
                  onMenu={(x, y) => setMenu({ x, y, message: m })}
                />
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
      <MessageMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}

function GridItem({
  message,
  onOpen,
  onMenu,
}: {
  message: Message;
  onOpen: () => void;
  /** Right-click: the same menu as the message in the chat. */
  onMenu: (x: number, y: number) => void;
}) {
  const lib = useLibrariesStore((st) => st.current);
  const media = message.media!;
  const thumb = useThumbUrl(lib, media);
  const isImage = isImageMedia(media);
  const pending = useThumbPending(lib, media);
  // Before its thumbnail exists, a plain image can show the original.
  const fallback =
    !thumb && isImage && !isHeicExt(media.ext) && lib && media.status === "ok"
      ? mediaSrc(lib, media.id)
      : null;
  const src = thumb ?? fallback;
  // Per URL, so a thumbnail that arrives after a failed original still shows.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = src !== null && failedSrc === src;
  const offline = media.status === "offline";
  const missing = media.status === "missing";
  const audio = media.kind === "audio";
  const playing = useAudioStore((s) => s.playing && s.track?.lib === lib && s.track.messageId === message.id);

  return (
    <button
      type="button"
      // Not `disabled`: a disabled button gets no right-click, and a missing
      // file still has a menu (copy path, delete).
      onClick={missing ? undefined : onOpen}
      aria-disabled={missing || undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      data-tip={offline ? "离线" : missing ? "缺失" : undefined}
      className={cn("relative aspect-square overflow-hidden rounded-md bg-app-subtle", missing && "cursor-default")}
    >
      {audio ? (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1.5">
          <AudioLines size={20} className={playing ? "text-app-accent" : "text-app-secondary"} />
          <span className="w-full truncate text-center text-2xs leading-4 text-app-secondary">{messageTitle(message) || "录音"}</span>
          {media.durationMs ? <span className="text-2xs leading-3 tabular-nums text-app-muted">{formatDuration(media.durationMs)}</span> : null}
        </span>
      ) : src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedSrc(src)}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-fast hover:opacity-90",
            (offline || missing) && "opacity-60 grayscale",
          )}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-app-muted">
          {pending && !missing && !offline ? <Loader2 size={16} className="animate-spin" /> : missing || failed ? <ImageOff size={18} /> : offline ? <CloudOff size={18} /> : media.kind === "video" ? <Play size={18} /> : <ImageOff size={18} />}
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
