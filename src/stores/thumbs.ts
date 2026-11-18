// What the thumbnail worker has produced this session, so media rendered from
// data fetched *before* its thumbnail existed can switch over without a
// refetch. Plus per-library queue length for the storage settings.

import { create } from "zustand";
import { thumbSrc } from "../ipc/client";
import type { MediaPayload } from "../types";

interface ThumbsState {
  /** `${lib}:${mediaId}` → true. */
  fresh: Record<string, true>;
  /** `${lib}:${mediaId}` → true: the worker gave up on it this session. */
  failed: Record<string, true>;
  /** Remaining jobs per library (only libraries the worker has visited). */
  remaining: Record<string, number>;
  markDone: (lib: string, mediaId: number) => void;
  markFailed: (lib: string, mediaId: number) => void;
  setRemaining: (lib: string, n: number) => void;
}

export const useThumbsStore = create<ThumbsState>((set) => ({
  fresh: {},
  failed: {},
  remaining: {},
  markDone: (lib, mediaId) =>
    set((s) => ({ fresh: { ...s.fresh, [`${lib}:${mediaId}`]: true } })),
  markFailed: (lib, mediaId) =>
    set((s) => ({ failed: { ...s.failed, [`${lib}:${mediaId}`]: true } })),
  setRemaining: (lib, n) =>
    set((s) =>
      s.remaining[lib] === n ? s : { remaining: { ...s.remaining, [lib]: n } },
    ),
}));

/** Thumbnail URL for a media item, or null while it has none. */
export function useThumbUrl(
  lib: string | null,
  media: Pick<MediaPayload, "id" | "hasThumb"> | null | undefined,
): string | null {
  const fresh = useThumbsStore((s) =>
    lib !== null && media != null ? s.fresh[`${lib}:${media.id}`] === true : false,
  );
  if (lib === null || media == null) return null;
  return media.hasThumb || fresh ? thumbSrc(lib, media.id) : null;
}

/** A thumbnail is still on its way: show a placeholder, not a broken icon. */
export function useThumbPending(
  lib: string | null,
  media: Pick<MediaPayload, "id" | "hasThumb" | "thumbPending"> | null | undefined,
): boolean {
  const key = lib !== null && media != null ? `${lib}:${media.id}` : "";
  const settled = useThumbsStore((s) => key !== "" && (s.fresh[key] === true || s.failed[key] === true));
  return media != null && !media.hasThumb && media.thumbPending === true && !settled;
}
