import { create } from "zustand";

/** Which library dialog is up. */
export type LibraryDialog =
  | { mode: "create" }
  | { mode: "settings"; id: string; tab?: "general" | "security" | "data" };

/** A recovery code to show once (after setting a password). */
export interface RecoveryReveal {
  code: string;
  /** What it unlocks, e.g. "Trove" or the library's name. */
  target: string;
}

/** What fills the window beside the space bar. */
export type MainView = "chats" | "favorites" | "map" | "stats";

interface SessionState {
  activeConversationId: number | null;
  profileDrawerOpen: boolean;
  newConversationOpen: boolean;
  settingsOpen: boolean;
  /** Section the settings dialog opens on. */
  settingsSection: string | null;
  view: MainView;
  /** Media the map should fly to once it has loaded ("show on map"). */
  mapFocus: number | null;
  lightboxMessageId: number | null;
  /** The info panel docked beside the chat, for this message (ADR-062).
   *  Takes the place of the conversation info. */
  infoMessageId: number | null;
  libraryDialog: LibraryDialog | null;
  /** Missing-files dialog for the current space. */
  missingFilesOpen: boolean;
  recovery: RecoveryReveal | null;
  /** Conversation whose "move to library" picker is open. */
  movingConversationId: number | null;
  setActiveConversation: (id: number | null) => void;
  setProfileDrawerOpen: (open: boolean) => void;
  setNewConversationOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean, section?: string) => void;
  setView: (view: MainView) => void;
  /** Open the map on one media item's position. */
  showOnMap: (mediaId: number) => void;
  clearMapFocus: () => void;
  openLightbox: (messageId: number) => void;
  closeLightbox: () => void;
  openInfo: (messageId: number) => void;
  closeInfo: () => void;
  setLibraryDialog: (d: LibraryDialog | null) => void;
  setMissingFilesOpen: (open: boolean) => void;
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
  view: "chats",
  mapFocus: null,
  lightboxMessageId: null,
  infoMessageId: null,
  libraryDialog: null,
  missingFilesOpen: false,
  recovery: null,
  movingConversationId: null,
  setActiveConversation: (id) =>
    set({
      activeConversationId: id,
      profileDrawerOpen: false,
      lightboxMessageId: null,
      infoMessageId: null,
    }),
  setProfileDrawerOpen: (open) =>
    set(open ? { profileDrawerOpen: true, infoMessageId: null } : { profileDrawerOpen: false }),
  setNewConversationOpen: (open) => set({ newConversationOpen: open }),
  setSettingsOpen: (open, section) =>
    set({ settingsOpen: open, settingsSection: open ? (section ?? null) : null }),
  setView: (view) => set({ view, mapFocus: null }),
  showOnMap: (mediaId) => set({ view: "map", mapFocus: mediaId, lightboxMessageId: null }),
  clearMapFocus: () => set({ mapFocus: null }),
  openLightbox: (messageId) => set({ lightboxMessageId: messageId }),
  closeLightbox: () => set({ lightboxMessageId: null }),
  openInfo: (messageId) => set({ infoMessageId: messageId, profileDrawerOpen: false }),
  closeInfo: () => set({ infoMessageId: null }),
  setLibraryDialog: (d) => set({ libraryDialog: d }),
  setMissingFilesOpen: (open) => set({ missingFilesOpen: open }),
  showRecovery: (r) => set({ recovery: r }),
  setMovingConversation: (id) => set({ movingConversationId: id }),
  resetForLibrary: () =>
    set({
      activeConversationId: null,
      profileDrawerOpen: false,
      lightboxMessageId: null,
      infoMessageId: null,
      mapFocus: null,
      newConversationOpen: false,
      movingConversationId: null,
      missingFilesOpen: false,
    }),
}));
