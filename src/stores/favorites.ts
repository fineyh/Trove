import { create } from "zustand";
import * as ipc from "../ipc/client";
import type { MediaPayload } from "../types";
import { toast } from "./toast";
import { useConvMediaStore } from "./convMedia";
import { useMessagesStore } from "./messages";

/** Bumped on every favorite change, so the favorites view knows to reload. */
export const useFavoritesStore = create<{ rev: number }>(() => ({ rev: 0 }));

/**
 * Favorite or unfavorite a file (ADR-063) and bring every copy of it that's
 * on screen along. Returns the new state.
 */
export async function setFavorite(lib: string, media: Pick<MediaPayload, "id">, favorite: boolean): Promise<boolean> {
  await ipc.setFavorite(lib, media.id, favorite);
  useMessagesStore.getState().patchMedia(media.id, { favorite });
  useConvMediaStore.getState().patchMedia(media.id, { favorite });
  useFavoritesStore.setState((s) => ({ rev: s.rev + 1 }));
  return favorite;
}

/** Flip a file's favorite from a button or the F key; failures are a toast. */
export function toggleFavorite(lib: string, media: Pick<MediaPayload, "id" | "favorite">): Promise<boolean | null> {
  const next = !media.favorite;
  return setFavorite(lib, media, next).catch((e) => {
    toast.error(next ? "无法收藏" : "无法取消收藏", e);
    return null;
  });
}
