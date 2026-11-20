import { ArrowLeft, Heart, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listFavorites } from "../../ipc/client";
import { isImageMedia } from "../../lib/media";
import { useFavoritesStore } from "../../stores/favorites";
import { useLibrariesStore } from "../../stores/libraries";
import { useMessagesStore } from "../../stores/messages";
import { useSessionStore } from "../../stores/session";
import type { Message, ViewerItem } from "../../types";
import { MessageMenu, type MessageMenuTarget } from "../chat/MessageMenu";
import { ItemsViewer } from "../info/ItemsViewer";
import { GridItem, openItem } from "../profile/MediaGrid";
import { IconButton } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Segmented } from "../ui/Segmented";

type Kind = "all" | "image" | "video" | "audio" | "other";

const KIND_LABEL: Record<Kind, string> = {
  all: "全部",
  image: "图片",
  video: "视频",
  audio: "录音",
  other: "文件",
};

function kindOf(m: Message): Exclude<Kind, "all"> {
  const media = m.media!;
  if (isImageMedia(media)) return "image";
  if (media.kind === "video") return "video";
  if (media.kind === "audio") return "audio";
  return "other";
}

function toViewerItem(m: Message): ViewerItem {
  const media = m.media!;
  return {
    mediaId: media.id,
    kind: media.kind,
    ext: media.ext,
    status: media.status,
    hasThumb: media.hasThumb,
    convId: m.convId,
    messageId: m.id,
    createdAt: m.createdAt,
    takenAt: media.takenAt,
    takenOffset: media.takenOffset,
  };
}

export function FavoritesView() {
  const open = useSessionStore((s) => s.view === "favorites");
  const lib = useLibrariesStore((s) => s.current);
  if (!open || lib === null) return null;
  // Keyed by space: ids are per space, nothing carries over.
  return <FavoritesPage key={lib} lib={lib} />;
}

/**
 * Every favorite in the space, across conversations (ADR-063), newest
 * favorite first. Like the map, a view of the space rather than of one
 * conversation.
 */
function FavoritesPage({ lib }: { lib: string }) {
  const setView = useSessionStore((s) => s.setView);
  const rev = useFavoritesStore((s) => s.rev);
  const [items, setItems] = useState<Message[] | null>(null);
  const [kind, setKind] = useState<Kind>("all");
  const [viewer, setViewer] = useState<{ items: ViewerItem[]; index: number } | null>(null);
  const [menu, setMenu] = useState<MessageMenuTarget | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const viewing = viewer !== null;

  // Reload after every change, but not under an open viewer: an item taken
  // out of the favorites there stays until the viewer closes, so the arrows
  // keep their place.
  useEffect(() => {
    if (viewing) return;
    let live = true;
    listFavorites(lib)
      .then((list) => live && setItems(list.filter((m) => m.media)))
      .catch(() => live && setItems((x) => x ?? []));
    return () => {
      live = false;
    };
  }, [lib, rev, viewing]);

  const kinds = useMemo(() => {
    const present = new Set((items ?? []).map(kindOf));
    return (["image", "video", "audio", "other"] as const).filter((k) => present.has(k));
  }, [items]);
  // A filter whose last item went away falls back to everything.
  const shownKind: Kind = kind !== "all" && !kinds.includes(kind) ? "all" : kind;
  const shown = useMemo(
    () => (items ?? []).filter((m) => shownKind === "all" || kindOf(m) === shownKind),
    [items, shownKind],
  );

  const view = (messageId: number) => {
    const list = shown.filter((m) => m.media!.kind === "video" || isImageMedia(m.media!));
    const index = list.findIndex((m) => m.id === messageId);
    if (index >= 0) setViewer({ items: list.map(toViewerItem), index });
  };

  const jump = (item: ViewerItem) => {
    setViewer(null);
    const s = useSessionStore.getState();
    s.setView("chats");
    s.setActiveConversation(item.convId);
    void useMessagesStore.getState().load(item.convId);
    s.openLightbox(item.messageId);
  };

  const loading = items === null;
  const empty = !loading && items.length === 0;

  return (
    <div className="fixed inset-y-0 left-16 right-0 z-40 flex flex-col border-l border-app-border bg-app">
      <header
        data-drag-region
        className="flex h-[52px] shrink-0 items-center gap-2 border-b border-app-border bg-app-panel pl-2.5 pr-[calc(var(--wc-width)+10px)]"
      >
        <IconButton label="返回会话" icon={<ArrowLeft size={18} />} onClick={() => setView("chats")} />
        <span className="text-base font-semibold">收藏</span>
        {!loading && !empty && (
          <span className="text-xs tabular-nums text-app-muted">{items.length.toLocaleString()}</span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-24 text-app-muted">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : empty ? (
          <div className="flex h-full items-center justify-center pb-16">
            <EmptyState
              icon={<Heart size={28} strokeWidth={1.5} />}
              title="没有收藏"
              description="在查看器中点击心形按钮，或按 F"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-6 pb-8 pt-5">
            {kinds.length > 1 && (
              <Segmented
                className="self-start"
                value={shownKind}
                onChange={setKind}
                options={(["all", ...kinds] as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
              />
            )}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5">
              {shown.map((m) => (
                <GridItem
                  key={m.id}
                  message={m}
                  className="rounded-lg"
                  onOpen={() => openItem(m, view)}
                  onMenu={(x, y) => setMenu({ x, y, message: m })}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <MessageMenu
        menu={menu}
        onClose={closeMenu}
        onDeleted={(m) => setItems((x) => x?.filter((i) => i.media?.id !== m.media?.id) ?? x)}
      />

      {viewer && (
        <ItemsViewer
          from="favorites"
          items={viewer.items}
          index={viewer.index}
          onClose={() => setViewer(null)}
          onIndexChange={(index) => setViewer((v) => (v ? { ...v, index } : v))}
          onJump={jump}
        />
      )}
    </div>
  );
}
