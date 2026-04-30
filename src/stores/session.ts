import { create } from "zustand";

interface SessionState {
  activeConversationId: number | null;
  profileDrawerOpen: boolean;
  setActiveConversation: (id: number | null) => void;
  setProfileDrawerOpen: (open: boolean) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  activeConversationId: null,
  profileDrawerOpen: false,
  setActiveConversation: (id) =>
    set({ activeConversationId: id, profileDrawerOpen: false }),
  setProfileDrawerOpen: (open) => set({ profileDrawerOpen: open }),
}));
