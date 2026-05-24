import { create } from "zustand";
import * as ipc from "../ipc/client";
import type {
  AppSettings,
  MissingFileStrategy,
  RepairScope,
  StorageStats,
  VolumePayload,
} from "../types";

const EMPTY_VOLUMES: readonly VolumePayload[] = Object.freeze([]);

interface SettingsState {
  settings: AppSettings;
  volumes: readonly VolumePayload[];
  stats: StorageStats | null;
  loading: boolean;
  load: () => Promise<void>;
  loadVolumes: () => Promise<void>;
  loadStats: () => Promise<void>;
  setMissingStrategy: (value: MissingFileStrategy) => Promise<void>;
  setRepairScope: (value: RepairScope) => Promise<void>;
  rescan: () => Promise<void>;
  forget: (id: number) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { missingFileStrategy: "hide", repairDefaultScope: "lastFolderOnly" },
  volumes: EMPTY_VOLUMES,
  stats: null,
  loading: false,
  load: async () => {
    set({ loading: true });
    try {
      const [settings, volumes, stats] = await Promise.all([
        ipc.getAllSettings(),
        ipc.listVolumes(),
        ipc.getStorageStats(),
      ]);
      set({ settings, volumes, stats, loading: false });
    } catch (e) {
      console.error("settings.load failed", e);
      set({ loading: false });
    }
  },
  loadVolumes: async () => {
    try {
      const volumes = await ipc.listVolumes();
      set({ volumes });
    } catch (e) {
      console.error("listVolumes failed", e);
    }
  },
  loadStats: async () => {
    try {
      const stats = await ipc.getStorageStats();
      set({ stats });
    } catch (e) {
      console.error("getStorageStats failed", e);
    }
  },
  setMissingStrategy: async (value) => {
    await ipc.setMissingFileStrategy(value);
    set((s) => ({ settings: { ...s.settings, missingFileStrategy: value } }));
  },
  setRepairScope: async (value) => {
    await ipc.setRepairDefaultScope(value);
    set((s) => ({ settings: { ...s.settings, repairDefaultScope: value } }));
  },
  rescan: async () => {
    await ipc.rescanVolumes();
    await Promise.all([get().loadVolumes(), get().loadStats()]);
  },
  forget: async (id) => {
    await ipc.forgetVolume(id);
    await Promise.all([get().loadVolumes(), get().loadStats()]);
  },
}));
