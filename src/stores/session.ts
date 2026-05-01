import { create } from "zustand";

interface SessionState {
  activeConversationId: number | null;
  profileDrawerOpen: boolean;
  newConversationOpen: boolean;
  lightboxMessageId: number | null;
  setActiveConversation: (id: number | null) => void;
  setProfileDrawerOpen: (open: boolean) => void;
  setNewConversationOpen: (open: boolean) => void;
  openLightbox: (messageId: number) => void;
  closeLightbox: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  activeConversationId: null,
  profileDrawerOpen: false,
  newConversationOpen: false,
  lightboxMessageId: null,
  setActiveConversation: (id) =>
    set({
      activeConversationId: id,
      profileDrawerOpen: false,
      lightboxMessageId: null,
    }),
  setProfileDrawerOpen: (open) => set({ profileDrawerOpen: open }),
  setNewConversationOpen: (open) => set({ newConversationOpen: open }),
  openLightbox: (messageId) => set({ lightboxMessageId: messageId }),
  closeLightbox: () => set({ lightboxMessageId: null }),
}));
