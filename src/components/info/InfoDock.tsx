import { useEffect, useState } from "react";
import { getMessages } from "../../ipc/client";
import { isImageMedia } from "../../lib/media";
import { useConvMediaStore } from "../../stores/convMedia";
import { useLibrariesStore } from "../../stores/libraries";
import { useMessagesStore } from "../../stores/messages";
import { useSessionStore } from "../../stores/session";
import type { Message } from "../../types";
import { useEscapeLayer } from "../ui/Modal";
import { InfoPanel } from "./InfoPanel";

/**
 * The info panel docked to the right of the chat, in place of the
 * conversation info (ADR-062). Opened from a message's menu, so it also
 * serves recordings and files, which have no viewer.
 */
export function InfoDock() {
  const id = useSessionStore((s) => s.infoMessageId);
  const convId = useSessionStore((s) => s.activeConversationId);
  const close = useSessionStore((s) => s.closeInfo);
  const openLightbox = useSessionStore((s) => s.openLightbox);
  const lightboxOpen = useSessionStore((s) => s.lightboxMessageId !== null);
  const lib = useLibrariesStore((s) => s.current) ?? "";

  // Usually already held by the chat or the media grid; kept in sync there
  // (a saved caption). Fetched once otherwise.
  const held = useMessagesStore((s) => (convId !== null && id !== null ? s.byConv[convId]?.find((m) => m.id === id) : undefined));
  const heldInGrid = useConvMediaStore((s) => (convId !== null && id !== null ? s.byConv[convId]?.find((m) => m.id === id) : undefined));
  const [fetched, setFetched] = useState<Message | null>(null);
  const message = held ?? heldInGrid ?? (fetched?.id === id ? fetched : null);

  useEffect(() => {
    if (id === null || held || heldInGrid || !lib) return;
    let live = true;
    getMessages(lib, [id])
      .then((list) => live && setFetched(list[0] ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, held, heldInGrid, lib]);

  // The viewer on top owns Esc while it's open.
  useEscapeLayer(id !== null && !lightboxOpen, close);

  if (id === null || !message?.media) return null;
  const media = message.media;
  const viewable = media.status === "ok" && (isImageMedia(media) || media.kind === "video");

  return (
    <div className="h-full animate-slide-in-right">
      <InfoPanel
        lib={lib}
        message={message}
        place="dock"
        onClose={close}
        onOpen={viewable ? () => openLightbox(message.id) : undefined}
        onCaptionSaved={(c) => setFetched((m) => (m && m.id === message.id ? { ...m, caption: c } : m))}
        onFavoriteChange={(on) =>
          setFetched((m) => (m?.media && m.id === message.id ? { ...m, media: { ...m.media, favorite: on } } : m))
        }
      />
    </div>
  );
}
