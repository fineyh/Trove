import { create } from "zustand";
import * as ipc from "../ipc/client";
import type { Conversation } from "../types";

interface ConversationsState {
  list: Conversation[];
  search: string;
  loading: boolean;
  setSearch: (q: string) => void;
  refresh: () => Promise<void>;
  createManual: (name: string) => Promise<number>;
  createFolderWatch: (name: string, sourcePath: string) => Promise<number>;
  togglePinned: (id: number, pinned: boolean) => Promise<void>;
  archive: (id: number) => Promise<void>;
  remove: (id: number) => Promise<void>;
  rename: (id: number, name: string) => Promise<void>;
}

export const useConversationsStore = create<ConversationsState>((set, get) => ({
  list: [],
  search: "",
  loading: false,
  setSearch: (q) => set({ search: q }),
  refresh: async () => {
    set({ loading: true });
    try {
      const list = await ipc.listConversations();
      set({ list, loading: false });
    } catch (e) {
      console.error("listConversations failed", e);
      set({ loading: false });
    }
  },
  createManual: async (name) => {
    const id = await ipc.createConversation({ name, kind: "manual" });
    await get().refresh();
    return id;
  },
  createFolderWatch: async (name, sourcePath) => {
    const id = await ipc.createConversation({
      name,
      kind: "folder_watch",
      sourcePath,
    });
    await get().refresh();
    return id;
  },
  togglePinned: async (id, pinned) => {
    await ipc.updateConversation({ id, pinned });
    await get().refresh();
  },
  archive: async (id) => {
    await ipc.updateConversation({ id, archived: true });
    await get().refresh();
  },
  remove: async (id) => {
    await ipc.deleteConversation(id);
    await get().refresh();
  },
  rename: async (id, name) => {
    await ipc.updateConversation({ id, name });
    await get().refresh();
  },
}));
