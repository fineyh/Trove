import { create } from "zustand";
import * as ipc from "../ipc/client";
import type { AppSettings, MissingFileStrategy, VolumePayload } from "../types";

const EMPTY_VOLUMES: readonly VolumePayload[] = Object.freeze([]);

interface SettingsState {
  settings: AppSettings;
  volumes: readonly VolumePayload[];
  loading: boolean;
  load: () => Promise<void>;
  loadVolumes: () => Promise<void>;
  setMissingStrategy: (value: MissingFileStrategy) => Promise<void>;
  rescan: () => Promise<void>;
  forget: (id: number) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { missingFileStrategy: "hide" },
  volumes: EMPTY_VOLUMES,
  loading: false,
  load: async () => {
    set({ loading: true });
    try {
      const [settings, volumes] = await Promise.all([
        ipc.getAllSettings(),
        ipc.listVolumes(),
      ]);
      set({ settings, volumes, loading: false });
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
  setMissingStrategy: async (value) => {
    await ipc.setMissingFileStrategy(value);
    set((s) => ({ settings: { ...s.settings, missingFileStrategy: value } }));
  },
  rescan: async () => {
    await ipc.rescanVolumes();
    await get().loadVolumes();
  },
  forget: async (id) => {
    await ipc.forgetVolume(id);
    await get().loadVolumes();
  },
}));
