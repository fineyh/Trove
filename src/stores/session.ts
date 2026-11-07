import { create } from "zustand";

/** Which library dialog is up. */
export type LibraryDialog =
  | { mode: "create" }
  | { mode: "settings"; id: string };

/** A recovery code to show once (after setting a password). */
export interface RecoveryReveal {
  code: string;
  /** What it unlocks, e.g. "Trove" or the library's name. */
  target: string;
}

interface SessionState {
  activeConversationId: number | null;
  profileDrawerOpen: boolean;
  newConversationOpen: boolean;
  settingsOpen: boolean;
  /** Section the settings dialog opens on. */
  settingsSection: string | null;
  mapOpen: boolean;
  lightboxMessageId: number | null;
  libraryDialog: LibraryDialog | null;
  recovery: RecoveryReveal | null;
  /** Conversation whose "move to library" picker is open. */
  movingConversationId: number | null;
  setActiveConversation: (id: number | null) => void;
  setProfileDrawerOpen: (open: boolean) => void;
  setNewConversationOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean, section?: string) => void;
  setMapOpen: (open: boolean) => void;
  openLightbox: (messageId: number) => void;
  closeLightbox: () => void;
  setLibraryDialog: (d: LibraryDialog | null) => void;
  showRecovery: (r: RecoveryReveal | null) => void;
  setMovingConversation: (id: number | null) => void;
  /** Library switched: nothing on screen belongs to the new one. */
  resetForLibrary: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  activeConversationId: null,
  profileDrawerOpen: false,
  newConversationOpen: false,
  settingsOpen: false,
  settingsSection: null,
  mapOpen: false,
  lightboxMessageId: null,
  libraryDialog: null,
  recovery: null,
  movingConversationId: null,
  setActiveConversation: (id) =>
    set({
      activeConversationId: id,
      profileDrawerOpen: false,
      lightboxMessageId: null,
    }),
  setProfileDrawerOpen: (open) => set({ profileDrawerOpen: open }),
  setNewConversationOpen: (open) => set({ newConversationOpen: open }),
  setSettingsOpen: (open, section) =>
    set({ settingsOpen: open, settingsSection: open ? (section ?? null) : null }),
  setMapOpen: (open) => set({ mapOpen: open }),
  openLightbox: (messageId) => set({ lightboxMessageId: messageId }),
  closeLightbox: () => set({ lightboxMessageId: null }),
  setLibraryDialog: (d) => set({ libraryDialog: d }),
  showRecovery: (r) => set({ recovery: r }),
  setMovingConversation: (id) => set({ movingConversationId: id }),
  resetForLibrary: () =>
    set({
      activeConversationId: null,
      profileDrawerOpen: false,
      lightboxMessageId: null,
      newConversationOpen: false,
      movingConversationId: null,
    }),
}));
