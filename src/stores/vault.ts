import { create } from "zustand";
import * as ipc from "../ipc/client";
import type { VaultStatus } from "../types";

type DialogMode = null | "set" | "change" | "remove" | "unlock-conv";

interface VaultState {
  status: VaultStatus;
  ready: boolean;
  dialog: DialogMode;
  /** When dialog === "unlock-conv", which conv we're unlocking. */
  pendingConvId: number | null;
  refresh: () => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => Promise<void>;
  setPassword: (password: string) => Promise<void>;
  changePassword: (oldPwd: string, newPwd: string) => Promise<void>;
  removePassword: (password: string) => Promise<void>;
  openDialog: (mode: Exclude<DialogMode, null>, convId?: number) => void;
  closeDialog: () => void;
}

const INITIAL: VaultStatus = { hasMasterPassword: false, unlocked: true };

export const useVaultStore = create<VaultState>((set, get) => ({
  status: INITIAL,
  ready: false,
  dialog: null,
  pendingConvId: null,
  refresh: async () => {
    try {
      const status = await ipc.vaultStatus();
      set({ status, ready: true });
    } catch (e) {
      console.error("vaultStatus failed", e);
      set({ ready: true });
    }
  },
  unlock: async (password) => {
    await ipc.vaultUnlock(password);
    await get().refresh();
  },
  lock: async () => {
    await ipc.vaultLock();
    await get().refresh();
  },
  setPassword: async (password) => {
    await ipc.vaultSetMasterPassword(password);
    await get().refresh();
  },
  changePassword: async (oldPwd, newPwd) => {
    await ipc.vaultChangePassword(oldPwd, newPwd);
    await get().refresh();
  },
  removePassword: async (password) => {
    await ipc.vaultRemoveMasterPassword(password);
    await get().refresh();
  },
  openDialog: (mode, convId) =>
    set({ dialog: mode, pendingConvId: convId ?? null }),
  closeDialog: () => set({ dialog: null, pendingConvId: null }),
}));
