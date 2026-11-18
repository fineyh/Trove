import { create } from "zustand";
import * as ipc from "../ipc/client";
import { toast } from "./toast";
import { currentLib, stillOn } from "./libraries";
import { adoptAvatar } from "../lib/avatar";
import type { Conversation } from "../types";

export const EMPTY_CONVERSATIONS: readonly Conversation[] = Object.freeze([]);

/** `lib:conv` pairs whose file-path avatar was already tried this run. */
const adoptTried = new Set<string>();

/**
 * Pictures picked from disk before v7 are still file paths; take each into
 * the library once (ADR-050). A file that can't be read now (moved, disk
 * not connected) is left alone and tried again on the next start.
 */
async function adoptFileAvatars(lib: string, list: readonly Conversation[]): Promise<boolean> {
  let stored = false;
  for (const c of list) {
    const key = `${lib}:${c.id}`;
    if (!c.avatarFile || adoptTried.has(key)) continue;
    adoptTried.add(key);
    try {
      if (await adoptAvatar(lib, c.id)) stored = true;
    } catch {
      // Not reachable right now; the avatar shows as the default meanwhile.
    }
  }
  return stored;
}

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
  /** `media:<id>` for a picture of this library, or a file path. */
  setAvatar: (id: number, avatar: string) => Promise<void>;
  /** Back to the default avatar. */
  clearAvatar: (id: number) => Promise<void>;
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
      if (!stillOn(lib)) return;
      set({ list, loading: false });
      if (list.some((c) => c.avatarFile)) {
        void adoptFileAvatars(lib, list).then((stored) => {
          if (stored && stillOn(lib)) void get().refresh();
        });
      }
    } catch (e) {
      if (stillOn(lib)) {
        toast.error("无法加载会话列表", e);
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
  setAvatar: async (id, avatar) => {
    const lib = currentLib();
    await ipc.updateConversation(lib, { id, avatarPath: avatar });
    if (!avatar.startsWith("media:")) {
      // A file: keep the picture, not the path. If it can't be shrunk here
      // the path stays and is served as before.
      adoptTried.add(`${lib}:${id}`);
      await adoptAvatar(lib, id).catch(() => false);
    }
    await get().refresh();
  },
  clearAvatar: async (id) => {
    await ipc.updateConversation(currentLib(), { id, clearAvatar: true });
    await get().refresh();
  },
  moveTo: async (id, targetLib) => {
    const newId = await ipc.moveConversation(currentLib(), id, targetLib);
    await get().refresh();
    return newId;
  },
}));
