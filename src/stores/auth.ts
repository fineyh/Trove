import { create } from "zustand";
import * as ipc from "../ipc/client";
import type { AuthStatus } from "../types";

const INITIAL: AuthStatus = {
  hasIdentity: false,
  email: null,
  displayName: null,
  pictureUrl: null,
  vaultUnlocked: true,
};

interface AuthState {
  status: AuthStatus;
  ready: boolean;
  busy: boolean;
  refresh: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: INITIAL,
  ready: false,
  busy: false,
  refresh: async () => {
    try {
      const status = await ipc.authStatus();
      set({ status, ready: true });
    } catch (e) {
      console.error("authStatus failed", e);
      set({ ready: true });
    }
  },
  login: async () => {
    set({ busy: true });
    try {
      const status = await ipc.googleLogin();
      set({ status, busy: false });
    } catch (e) {
      set({ busy: false });
      throw e;
    }
  },
  logout: async () => {
    set({ busy: true });
    try {
      await ipc.logout();
      const status = await ipc.authStatus();
      set({ status, busy: false });
    } catch (e) {
      set({ busy: false });
      throw e;
    }
  },
}));
