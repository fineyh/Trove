import { create } from "zustand";
import * as ipc from "../ipc/client";
import { currentLib, stillOn } from "./libraries";
import { toast } from "./toast";
import type { AppSettings, StorageStats, VolumePayload } from "../types";

const EMPTY_VOLUMES: readonly VolumePayload[] = Object.freeze([]);

interface SettingsState {
  /** App-wide (stored in the main library). */
  settings: AppSettings;
  /** Current library's volumes and stats. */
  volumes: readonly VolumePayload[];
  stats: StorageStats | null;
  loading: boolean;
  load: () => Promise<void>;
  loadSettings: () => Promise<void>;
  loadVolumes: () => Promise<void>;
  loadStats: () => Promise<void>;
  resetLibraryData: () => void;
  save: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  rescan: () => Promise<void>;
  forget: (id: number) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: ipc.DEFAULT_SETTINGS,
  volumes: EMPTY_VOLUMES,
  stats: null,
  loading: false,
  load: async () => {
    set({ loading: true });
    await Promise.all([get().loadSettings(), get().loadVolumes(), get().loadStats()]);
    set({ loading: false });
  },
  loadSettings: async () => {
    try {
      set({ settings: await ipc.getAllSettings() });
    } catch (e) {
      toast.error("读取设置失败", e);
    }
  },
  loadVolumes: async () => {
    const lib = currentLib();
    try {
      const volumes = await ipc.listVolumes(lib);
      if (stillOn(lib)) set({ volumes });
    } catch (e) {
      if (stillOn(lib)) toast.error("读取磁盘列表失败", e);
    }
  },
  loadStats: async () => {
    const lib = currentLib();
    try {
      const stats = await ipc.getStorageStats(lib);
      if (stillOn(lib)) set({ stats });
    } catch (e) {
      if (stillOn(lib)) toast.error("读取存储统计失败", e);
    }
  },
  resetLibraryData: () => set({ volumes: EMPTY_VOLUMES, stats: null }),
  save: async (key, value) => {
    await ipc.saveSetting(key, value);
    set((s) => ({ settings: { ...s.settings, [key]: value } }));
  },
  rescan: async () => {
    await ipc.rescanVolumes(currentLib());
    await Promise.all([get().loadVolumes(), get().loadStats()]);
  },
  forget: async (id) => {
    await ipc.forgetVolume(currentLib(), id);
    await Promise.all([get().loadVolumes(), get().loadStats()]);
  },
}));
