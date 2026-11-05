import { create } from "zustand";
import * as ipc from "../ipc/client";
import { useConvMediaStore } from "./convMedia";
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
  load: async (convId) => {
    set((s) => ({ loading: { ...s.loading, [convId]: true } }));
    try {
      const list = await ipc.listMessages({ convId, limit: PAGE_SIZE });
      set((s) => ({
        byConv: { ...s.byConv, [convId]: list },
        hasMore: { ...s.hasMore, [convId]: list.length >= PAGE_SIZE },
        loading: { ...s.loading, [convId]: false },
      }));
    } catch (e) {
      toast.error("加载消息失败", e);
      set((s) => ({ loading: { ...s.loading, [convId]: false } }));
    }
  },
  loadOlder: async (convId) => {
    const s = get();
    if (s.loadingOlder[convId] || s.hasMore[convId] === false) return;
    const held = s.byConv[convId];
    if (!held || held.length === 0) return;
    const oldest = held[0];
    set((st) => ({ loadingOlder: { ...st.loadingOlder, [convId]: true } }));
    try {
      const older = await ipc.listMessages({
        convId,
        before: { createdAt: oldest.createdAt, id: oldest.id },
        limit: PAGE_SIZE,
      });
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
      toast.error("加载更早的消息失败", e);
      set((st) => ({ loadingOlder: { ...st.loadingOlder, [convId]: false } }));
    }
  },
  sendText: async (convId, text) => {
    const msg = await ipc.sendText(convId, text);
    set((s) => ({
      byConv: {
        ...s.byConv,
        [convId]: [...(s.byConv[convId] ?? []), msg],
      },
    }));
  },
  importFiles: async (convId, paths) => {
    await ipc.importFiles(convId, paths);
    // Back to the newest page — that's where the just-imported files are.
    await get().load(convId);
    // The media sequence the viewer/grid page over just grew; drop its cache
    // so the next open refetches instead of showing a stale list.
    useConvMediaStore.getState().invalidate(convId);
  },
  registerPlay: async (messageId) => {
    const next = await ipc.incrementPlayCount(messageId);
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
    await ipc.deleteMessage(messageId, deleteFile);
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
