import { create } from "zustand";
import * as ipc from "../ipc/client";
import { useLibrariesStore } from "./libraries";
import { toast } from "./toast";
import type { AppSettings } from "../types";

interface SettingsState {
  /** App-wide (stored in the main space). */
  settings: AppSettings;
  /** The data folder; shown under Backup. */
  dataDir: string | null;
  load: () => Promise<void>;
  loadSettings: () => Promise<void>;
  save: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: ipc.DEFAULT_SETTINGS,
  dataDir: null,
  load: async () => {
    await get().loadSettings();
    if (get().dataDir) return;
    const main = useLibrariesStore.getState().list.find((l) => l.isMain);
    if (!main) return;
    try {
      // Every space answers with the same folder; the main one is always open.
      const stats = await ipc.getStorageStats(main.id);
      set({ dataDir: stats?.dataDir ?? null });
    } catch {
      // Only the backup page shows it; it stays blank.
    }
  },
  loadSettings: async () => {
    try {
      set({ settings: await ipc.getAllSettings() });
    } catch (e) {
      toast.error("无法读取设置", e);
    }
  },
  save: async (key, value) => {
    await ipc.saveSetting(key, value);
    set((s) => ({ settings: { ...s.settings, [key]: value } }));
  },
}));
