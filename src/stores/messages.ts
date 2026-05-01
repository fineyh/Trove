import { create } from "zustand";
import * as ipc from "../ipc/client";
import type { Message } from "../types";

/** Stable empty reference — return this from selectors instead of `?? []`
 *  to keep Zustand's getSnapshot output reference-equal across renders. */
export const EMPTY_MESSAGES: readonly Message[] = Object.freeze([]);

interface MessagesState {
  byConv: Record<number, Message[]>;
  loading: Record<number, boolean>;
  load: (convId: number) => Promise<void>;
  sendText: (convId: number, text: string) => Promise<void>;
  importFiles: (convId: number, paths: string[]) => Promise<void>;
  registerPlay: (messageId: number) => Promise<void>;
  remove: (messageId: number, convId: number) => Promise<void>;
}

export const useMessagesStore = create<MessagesState>((set, get) => ({
  byConv: {},
  loading: {},
  load: async (convId) => {
    set((s) => ({ loading: { ...s.loading, [convId]: true } }));
    try {
      const list = await ipc.listMessages({ convId });
      set((s) => ({
        byConv: { ...s.byConv, [convId]: list },
        loading: { ...s.loading, [convId]: false },
      }));
    } catch (e) {
      console.error("listMessages failed", e);
      set((s) => ({ loading: { ...s.loading, [convId]: false } }));
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
    await get().load(convId);
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
  remove: async (messageId, convId) => {
    await ipc.deleteMessage(messageId);
    await get().load(convId);
  },
}));
