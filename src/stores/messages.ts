import { create } from "zustand";
import * as ipc from "../ipc/client";
import { useConvMediaStore } from "./convMedia";
import { useConversationsStore } from "./conversations";
import { currentLib, stillOn } from "./libraries";
import { toast } from "./toast";
import type { Message } from "../types";

/** Stable empty reference — return this from selectors instead of `?? []`
 *  to keep Zustand's getSnapshot output reference-equal across renders. */
export const EMPTY_MESSAGES: readonly Message[] = Object.freeze([]);

/** Messages per page. The first page is the *newest* `PAGE_SIZE` messages;
 *  scrolling to the top walks backwards one page at a time. */
export const PAGE_SIZE = 60;

interface MessagesState {
  byConv: Record<number, Message[]>;
  loading: Record<number, boolean>;
  loadingOlder: Record<number, boolean>;
  /** False once a page came back short — nothing older left to fetch. */
  hasMore: Record<number, boolean>;
  load: (convId: number) => Promise<void>;
  /** Re-fetch the span already held, in place, after a background change
   *  (watcher, volumes). Unlike `load` it keeps older pages and the reader's
   *  scroll position (todo 2.5). */
  refresh: (convId: number) => Promise<void>;
  /** Bumped when the user's own action (send, import) should bring the
   *  list to its end. Background additions never move the view. */
  jumpToEnd: number;
  /** Drop every cache (library switched). */
  reset: () => void;
  loadOlder: (convId: number) => Promise<void>;
  sendText: (convId: number, text: string) => Promise<void>;
  importFiles: (convId: number, paths: string[]) => Promise<void>;
  registerPlay: (messageId: number) => Promise<void>;
  remove: (
    messageId: number,
    convId: number,
    deleteFile?: boolean,
  ) => Promise<void>;
}

export const useMessagesStore = create<MessagesState>((set, get) => ({
  byConv: {},
  loading: {},
  loadingOlder: {},
  hasMore: {},
  jumpToEnd: 0,
  reset: () => set({ byConv: {}, loading: {}, loadingOlder: {}, hasMore: {} }),
  load: async (convId) => {
    const lib = currentLib();
    set((s) => ({ loading: { ...s.loading, [convId]: true } }));
    try {
      const list = await ipc.listMessages(lib, { convId, limit: PAGE_SIZE });
      if (!stillOn(lib)) return;
      set((s) => ({
        byConv: { ...s.byConv, [convId]: list },
        hasMore: { ...s.hasMore, [convId]: list.length >= PAGE_SIZE },
        loading: { ...s.loading, [convId]: false },
      }));
    } catch (e) {
      if (!stillOn(lib)) return;
      toast.error("加载消息失败", e);
      set((s) => ({ loading: { ...s.loading, [convId]: false } }));
    }
  },
  refresh: async (convId) => {
    const held = get().byConv[convId];
    if (!held || held.length === 0) return get().load(convId);
    const lib = currentLib();
    // Everything is held already: re-fetch the whole conversation, since a
    // file with an old mtime can land before the current first message.
    const whole = get().hasMore[convId] === false;
    const oldest = held[0];
    try {
      const list = await ipc.listMessages(lib, {
        convId,
        from: whole ? undefined : { createdAt: oldest.createdAt, id: oldest.id },
        limit: -1,
      });
      if (!stillOn(lib)) return;
      if (list.length === 0 && !whole) return get().load(convId);
      set((s) => {
        // A `loadOlder` may have landed while we waited: keep what it added
        // below our window.
        const current = s.byConv[convId] ?? [];
        const below = whole
          ? []
          : current.filter(
              (m) =>
                m.createdAt < oldest.createdAt ||
                (m.createdAt === oldest.createdAt && m.id < oldest.id),
            );
        return { byConv: { ...s.byConv, [convId]: [...below, ...list] } };
      });
    } catch (e) {
      if (!stillOn(lib)) return;
      toast.error("加载消息失败", e);
    }
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
      const older = await ipc.listMessages(lib, {
        convId,
        before: { createdAt: oldest.createdAt, id: oldest.id },
        limit: PAGE_SIZE,
      });
      if (!stillOn(lib)) return;
      set((st) => {
        // Re-read the list: a full `load` may have replaced it while we waited.
        const current = st.byConv[convId] ?? [];
        const seen = new Set(current.map((m) => m.id));
        const fresh = older.filter((m) => !seen.has(m.id));
        return {
          byConv: { ...st.byConv, [convId]: [...fresh, ...current] },
          hasMore: { ...st.hasMore, [convId]: older.length >= PAGE_SIZE },
          loadingOlder: { ...st.loadingOlder, [convId]: false },
        };
      });
    } catch (e) {
      if (!stillOn(lib)) return;
      toast.error("加载更早的消息失败", e);
      set((st) => ({ loadingOlder: { ...st.loadingOlder, [convId]: false } }));
    }
  },
  sendText: async (convId, text) => {
    const msg = await ipc.sendText(currentLib(), convId, text);
    set((s) => ({
      byConv: {
        ...s.byConv,
        [convId]: [...(s.byConv[convId] ?? []), msg],
      },
      jumpToEnd: s.jumpToEnd + 1,
    }));
    // The list's preview and "x minutes ago" move with it.
    void useConversationsStore.getState().refresh();
  },
  importFiles: async (convId, paths) => {
    await ipc.importFiles(currentLib(), convId, paths);
    void useConversationsStore.getState().refresh();
    // Back to the newest page — that's where the just-imported files are.
    await get().load(convId);
    set((s) => ({ jumpToEnd: s.jumpToEnd + 1 }));
    // The media sequence the viewer/grid page over just grew; drop its cache
    // so the next open refetches instead of showing a stale list.
    useConvMediaStore.getState().invalidate(convId);
  },
  registerPlay: async (messageId) => {
    const next = await ipc.incrementPlayCount(currentLib(), messageId);
    set((s) => {
      const out: Record<number, Message[]> = {};
      for (const [k, list] of Object.entries(s.byConv)) {
        out[Number(k)] = list.map((m) =>
          m.id === messageId ? { ...m, playCount: next } : m,
        );
      }
      return { byConv: out };
    });
  },
  remove: async (messageId, convId, deleteFile = false) => {
    await ipc.deleteMessage(currentLib(), messageId, deleteFile);
    // Drop it locally instead of reloading: a reload would snap the view back
    // to the newest page, losing wherever the user had scrolled to.
    set((s) => ({
      byConv: {
        ...s.byConv,
        [convId]: (s.byConv[convId] ?? []).filter((m) => m.id !== messageId),
      },
    }));
    // Same treatment for the media sequence: drop it locally rather than
    // invalidating, so an open grid/viewer keeps its scroll position.
    useConvMediaStore.getState().removeLocal(convId, messageId);
  },
}));
