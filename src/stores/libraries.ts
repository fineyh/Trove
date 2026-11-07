// Libraries (ADR-038): the switchable spaces. One is "current"; every
// per-library store reads `currentLib()` when it talks to the backend.
//
// This store deliberately imports no other store. Switching libraries resets
// the per-library caches (messages, media, conversations…) from App.tsx,
// which subscribes to `current`.

import { create } from "zustand";
import * as ipc from "../ipc/client";
import { toast } from "./toast";
import type { LibraryInfo, UnlockMethod } from "../types";

export const EMPTY_LIBRARIES: readonly LibraryInfo[] = Object.freeze([]);

/** Library tile colors. Keys are stored; tuned to sit beside the indigo accent. */
export const LIBRARY_COLORS: Record<string, { bg: string; fg: string }> = {
  indigo: { bg: "#4F6BED", fg: "#ffffff" },
  blue: { bg: "#2F86DE", fg: "#ffffff" },
  teal: { bg: "#139484", fg: "#ffffff" },
  green: { bg: "#3D9A50", fg: "#ffffff" },
  amber: { bg: "#D48C1A", fg: "#ffffff" },
  orange: { bg: "#E26A2C", fg: "#ffffff" },
  red: { bg: "#DB4B4B", fg: "#ffffff" },
  pink: { bg: "#D9488F", fg: "#ffffff" },
  violet: { bg: "#8B5CDB", fg: "#ffffff" },
  slate: { bg: "#5E6878", fg: "#ffffff" },
};

export const DEFAULT_LIBRARY_COLOR = "indigo";

export function libraryColor(key: string | null | undefined) {
  return LIBRARY_COLORS[key ?? ""] ?? LIBRARY_COLORS.blue;
}

interface LibrariesState {
  list: readonly LibraryInfo[];
  /** Id of the library on screen; null until the first load. */
  current: string | null;
  ready: boolean;
  refresh: () => Promise<void>;
  select: (id: string) => void;
  unlock: (id: string, secret: string, method: UnlockMethod) => Promise<void>;
  lock: (id: string) => Promise<void>;
  /** Forget everything (app locked). */
  clear: () => void;
}

export const useLibrariesStore = create<LibrariesState>((set, get) => ({
  list: EMPTY_LIBRARIES,
  current: null,
  ready: false,

  refresh: async () => {
    try {
      const list = await ipc.listLibraries();
      const { current } = get();
      // Keep the current library when it still exists; otherwise fall back
      // to the main one (it was deleted, or re-keyed under a new id).
      const keep = current !== null && list.some((l) => l.id === current);
      const main = list.find((l) => l.isMain) ?? list[0];
      set({
        list,
        current: keep ? current : (main?.id ?? null),
        ready: true,
      });
    } catch (e) {
      toast.error("读取库列表失败", e);
      set({ ready: true });
    }
  },

  select: (id) => {
    if (get().current !== id) set({ current: id });
  },

  unlock: async (id, secret, method) => {
    await ipc.unlockLibrary(id, secret, method);
    await get().refresh();
  },

  lock: async (id) => {
    await ipc.lockLibrary(id);
    await get().refresh();
  },

  clear: () => set({ list: EMPTY_LIBRARIES, current: null, ready: false }),
}));

/** The library every per-library call goes to. Throws when none is chosen
 *  yet, which only happens before the app is unlocked. */
export function currentLib(): string {
  const id = useLibrariesStore.getState().current;
  if (id === null) throw new Error("没有打开的库");
  return id;
}

/** After an `await`: is the user still looking at library `lib`? Results
 *  for a library they switched away from must not land in the caches. */
export function stillOn(lib: string): boolean {
  return useLibrariesStore.getState().current === lib;
}

/** The current library's info (stable reference from the list). */
export function useCurrentLibrary(): LibraryInfo | null {
  return useLibrariesStore(
    (s) => s.list.find((l) => l.id === s.current) ?? null,
  );
}

/** Current library is open (not a locked encrypted one). */
export function useCurrentLibraryOpen(): boolean {
  return useLibrariesStore((s) => {
    const l = s.list.find((x) => x.id === s.current);
    return l?.unlocked === true;
  });
}
