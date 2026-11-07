// A conversation's *media* sequence, paged independently of the chat.
//
// Why this exists: `stores/messages.ts` holds the slice of chat the user has
// scrolled into memory (the newest `PAGE_SIZE`, plus whatever `loadOlder`
// added). The fullscreen viewer and the profile drawer's grid used to read
// that same slice, so in a conversation with thousands of photos the viewer's
// arrow keys reached only the newest few dozen and the grid showed only those
// — with no hint that anything else existed. Both now page over the media
// sequence itself (`list_conv_media`), which uses the same `(createdAt, id)`
// row-value cursor as the chat because `created_at` is not monotonic with `id`
// (folder scans store the file's mtime).

import { create } from "zustand";
import * as ipc from "../ipc/client";
import { currentLib, stillOn } from "./libraries";
import { toast } from "./toast";
import type { Message } from "../types";

/** Stable empty reference — return this from selectors instead of `?? []`
 *  to keep Zustand's getSnapshot output reference-equal across renders. */
export const EMPTY_MEDIA: readonly Message[] = Object.freeze([]);

/** Media items per page. Larger than the chat's page: a 3-column grid and a
 *  viewer being arrowed through both burn through items much faster than
 *  reading a chat does. */
export const MEDIA_PAGE_SIZE = 80;

/** Safety net for `ensureContains`: a target that never shows up (deleted
 *  between render and click, filtered out by the offline-content setting, …) must
 *  not page an entire library into memory. */
const MAX_ENSURE_PAGES = 25;

interface ConvMediaState {
  byConv: Record<number, Message[]>;
  loading: Record<number, boolean>;
  loadingOlder: Record<number, boolean>;
  /** False once a page came back short — nothing older left to fetch. */
  hasMore: Record<number, boolean>;
  /** Fetch the newest page, replacing whatever is held. */
  load: (convId: number) => Promise<void>;
  /** Fetch the newest page only if nothing is held yet. */
  ensureLoaded: (convId: number) => Promise<void>;
  loadOlder: (convId: number) => Promise<void>;
  /** Page backwards until `messageId` is held (or nothing older is left), so
   *  the viewer can open on an item the chat had scrolled past. */
  ensureContains: (convId: number, messageId: number) => Promise<void>;
  /** Drop every cache (library switched). */
  reset: () => void;
  /** Forget a conversation's cache — the media set changed underneath us. */
  invalidate: (convId: number) => void;
  /** Drop one item locally, the way `messages.remove` does, so the grid and
   *  viewer don't snap back to the newest page after a delete. */
  removeLocal: (convId: number, messageId: number) => void;
}

export const useConvMediaStore = create<ConvMediaState>((set, get) => ({
  byConv: {},
  loading: {},
  loadingOlder: {},
  hasMore: {},

  reset: () => set({ byConv: {}, loading: {}, loadingOlder: {}, hasMore: {} }),

  load: async (convId) => {
    const lib = currentLib();
    set((s) => ({ loading: { ...s.loading, [convId]: true } }));
    try {
      const list = await ipc.listConvMedia(lib, { convId, limit: MEDIA_PAGE_SIZE });
      if (!stillOn(lib)) return;
      set((s) => ({
        byConv: { ...s.byConv, [convId]: list },
        hasMore: { ...s.hasMore, [convId]: list.length >= MEDIA_PAGE_SIZE },
        loading: { ...s.loading, [convId]: false },
      }));
    } catch (e) {
      if (!stillOn(lib)) return;
      toast.error("加载媒体列表失败", e);
      set((s) => ({ loading: { ...s.loading, [convId]: false } }));
    }
  },

  ensureLoaded: async (convId) => {
    const s = get();
    if (s.byConv[convId] !== undefined || s.loading[convId]) return;
    await get().load(convId);
  },

  loadOlder: async (convId) => {
    const s = get();
    if (s.loadingOlder[convId] || s.hasMore[convId] === false) return;
    const held = s.byConv[convId];
    if (!held || held.length === 0) return;
    const oldest = held[0];
    const lib = currentLib();
    set((st) => ({ loadingOlder: { ...st.loadingOlder, [convId]: true } }));
    try {
      const older = await ipc.listConvMedia(lib, {
        convId,
        before: { createdAt: oldest.createdAt, id: oldest.id },
        limit: MEDIA_PAGE_SIZE,
      });
      if (!stillOn(lib)) return;
      set((st) => {
        // Re-read: a full `load` may have replaced the list while we waited.
        const current = st.byConv[convId] ?? [];
        const seen = new Set(current.map((m) => m.id));
        const fresh = older.filter((m) => !seen.has(m.id));
        return {
          byConv: { ...st.byConv, [convId]: [...fresh, ...current] },
          hasMore: { ...st.hasMore, [convId]: older.length >= MEDIA_PAGE_SIZE },
          loadingOlder: { ...st.loadingOlder, [convId]: false },
        };
      });
    } catch (e) {
      if (!stillOn(lib)) return;
      toast.error("加载更早的媒体失败", e);
      set((st) => ({ loadingOlder: { ...st.loadingOlder, [convId]: false } }));
    }
  },

  ensureContains: async (convId, messageId) => {
    await get().ensureLoaded(convId);
    const has = (): boolean =>
      (get().byConv[convId] ?? []).some((m) => m.id === messageId);
    for (let i = 0; i < MAX_ENSURE_PAGES && !has(); i++) {
      if (get().hasMore[convId] === false) return;
      const before = get().byConv[convId]?.length ?? 0;
      await get().loadOlder(convId);
      // No growth means the page came back empty or fully deduped — stop
      // rather than spin on the same cursor.
      if ((get().byConv[convId]?.length ?? 0) === before) return;
    }
  },

  invalidate: (convId) =>
    set((s) => {
      const byConv = { ...s.byConv };
      const hasMore = { ...s.hasMore };
      delete byConv[convId];
      delete hasMore[convId];
      return { byConv, hasMore };
    }),

  removeLocal: (convId, messageId) =>
    set((s) => {
      const held = s.byConv[convId];
      if (!held) return {};
      return {
        byConv: {
          ...s.byConv,
          [convId]: held.filter((m) => m.id !== messageId),
        },
      };
    }),
}));
