// App-level security (ADR-036): startup password, app lock, recovery code.
// Library-level passwords live with the libraries store.

import { create } from "zustand";
import * as ipc from "../ipc/client";
import { toast } from "./toast";
import type { SecurityStatus, UnlockMethod } from "../types";

interface SecurityState {
  status: SecurityStatus | null;
  ready: boolean;
  refresh: () => Promise<void>;
  unlock: (secret: string, method: UnlockMethod) => Promise<void>;
  lock: () => Promise<void>;
  /** Returns the recovery code, shown once. */
  setPassword: (password: string) => Promise<string>;
  changePassword: (oldPwd: string, newPwd: string) => Promise<void>;
  removePassword: (password: string) => Promise<void>;
  resetRecovery: (password: string) => Promise<string>;
}

export const useSecurityStore = create<SecurityState>((set, get) => ({
  status: null,
  ready: false,
  refresh: async () => {
    try {
      const status = await ipc.securityStatus();
      set({ status, ready: true });
    } catch (e) {
      toast.error("读取安全状态失败", e);
      set({ ready: true });
    }
  },
  unlock: async (secret, method) => {
    await ipc.appUnlock(secret, method);
    await get().refresh();
  },
  lock: async () => {
    await ipc.appLock();
    await get().refresh();
  },
  setPassword: async (password) => {
    const code = await ipc.appSetPassword(password);
    await get().refresh();
    return code;
  },
  changePassword: async (oldPwd, newPwd) => {
    await ipc.appChangePassword(oldPwd, newPwd);
    await get().refresh();
  },
  removePassword: async (password) => {
    await ipc.appRemovePassword(password);
    await get().refresh();
  },
  resetRecovery: async (password) => {
    const code = await ipc.appResetRecovery(password);
    await get().refresh();
    return code;
  },
}));
