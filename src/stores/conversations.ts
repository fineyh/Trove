import { create } from "zustand";
import * as ipc from "../ipc/client";
import { toast } from "./toast";
import { currentLib, stillOn } from "./libraries";
import type { Conversation } from "../types";

export const EMPTY_CONVERSATIONS: readonly Conversation[] = Object.freeze([]);

interface ConversationsState {
  list: readonly Conversation[];
  search: string;
  loading: boolean;
  setSearch: (q: string) => void;
  refresh: () => Promise<void>;
  reset: () => void;
  createManual: (name: string) => Promise<number>;
  createManualFromFolder: (
    folderPath: string,
    name?: string,
  ) => Promise<{ convId: number; imported: number }>;
  createFolderWatch: (name: string, sourcePath: string) => Promise<number>;
  togglePinned: (id: number, pinned: boolean) => Promise<void>;
  remove: (id: number) => Promise<void>;
  rename: (id: number, name: string) => Promise<void>;
  setAvatar: (id: number, path: string) => Promise<void>;
  /** Move to another library; returns the id it has there. */
  moveTo: (id: number, targetLib: string) => Promise<number>;
}

export const useConversationsStore = create<ConversationsState>((set, get) => ({
  list: EMPTY_CONVERSATIONS,
  search: "",
  loading: false,
  setSearch: (q) => set({ search: q }),
  refresh: async () => {
    const lib = currentLib();
    set({ loading: true });
    try {
      const list = await ipc.listConversations(lib);
      if (stillOn(lib)) set({ list, loading: false });
    } catch (e) {
      if (stillOn(lib)) {
        toast.error("加载会话列表失败", e);
        set({ loading: false });
      }
    }
  },
  reset: () => set({ list: EMPTY_CONVERSATIONS, search: "", loading: false }),
  createManual: async (name) => {
    const id = await ipc.createConversation(currentLib(), { name, kind: "manual" });
    await get().refresh();
    return id;
  },
  createManualFromFolder: async (folderPath, name) => {
    const result = await ipc.createManualFromFolder(currentLib(), folderPath, name);
    await get().refresh();
    return result;
  },
  createFolderWatch: async (name, sourcePath) => {
    const id = await ipc.createConversation(currentLib(), {
      name,
      kind: "folder_watch",
      sourcePath,
    });
    await get().refresh();
    return id;
  },
  togglePinned: async (id, pinned) => {
    await ipc.updateConversation(currentLib(), { id, pinned });
    await get().refresh();
  },
  remove: async (id) => {
    await ipc.deleteConversation(currentLib(), id);
    await get().refresh();
  },
  rename: async (id, name) => {
    await ipc.updateConversation(currentLib(), { id, name });
    await get().refresh();
  },
  setAvatar: async (id, path) => {
    await ipc.updateConversation(currentLib(), { id, avatarPath: path });
    await get().refresh();
  },
  moveTo: async (id, targetLib) => {
    const newId = await ipc.moveConversation(currentLib(), id, targetLib);
    await get().refresh();
    return newId;
  },
}));
