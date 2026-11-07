import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./components/layout/Sidebar";
import { ChatList } from "./components/layout/ChatList";
import { ChatView } from "./components/layout/ChatView";
import { UnlockScreen } from "./components/layout/UnlockScreen";
import { NewConversationDialog } from "./components/dialogs/NewConversationDialog";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";
import { ProfileDrawer } from "./components/profile/ProfileDrawer";
import { MapView } from "./components/map/MapView";
import { LibraryLockedView } from "./components/library/LibraryLockedView";
import {
  CreateLibraryDialog,
  LibrarySettingsDialog,
} from "./components/library/LibraryDialogs";
import { MoveConversationDialog } from "./components/library/MoveConversationDialog";
import { RecoveryCodeDialog } from "./components/library/RecoveryCodeDialog";
import {
  onConvChanged,
  onImportProgress,
  onLibrariesChanged,
  onSecurityChanged,
  onVolumesChanged,
  openUrl,
} from "./ipc/client";
import { useConversationsStore } from "./stores/conversations";
import { useConvMediaStore } from "./stores/convMedia";
import { useImportJobStore } from "./stores/importJob";
import { useCurrentLibrary, useLibrariesStore } from "./stores/libraries";
import { useMessagesStore } from "./stores/messages";
import { useSecurityStore } from "./stores/security";
import { useSessionStore } from "./stores/session";
import { useSettingsStore } from "./stores/settings";
import { isTauri } from "./hooks/useIsTauri";
import { useIdleLock } from "./hooks/useIdleLock";
import { closeAllPlayerWindows } from "./lib/playerWindow";
import { startThumbWorker, kickThumbs } from "./lib/thumbWorker";

export default function App() {
  const ready = useSecurityStore((s) => s.ready);
  const unlocked = useSecurityStore((s) => s.status?.appUnlocked === true);

  useEffect(() => {
    void useSecurityStore.getState().refresh();
    // Locking the app (from here, the idle timer or another window) and
    // password changes all come through this event.
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void onSecurityChanged(() => void useSecurityStore.getState().refresh()).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useExternalLinks();
  useClosePlayersWithMain();

  if (!ready) return <div className="flex h-screen w-screen bg-app" />;
  if (!unlocked) return <UnlockScreen />;
  return <Shell />;
}

/** Everything behind the app lock. Mounted only while the app is unlocked,
 *  so locking tears down every subscription and cache with it. */
function Shell() {
  const librariesReady = useLibrariesStore((s) => s.ready);
  const current = useLibrariesStore((s) => s.current);
  const lib = useCurrentLibrary();
  const open = lib?.unlocked === true;

  // Libraries + app-wide settings once; forget them on lock.
  useEffect(() => {
    void useLibrariesStore.getState().refresh();
    void useSettingsStore.getState().loadSettings();
    return () => {
      // Popups keep playing what they loaded; locked means nothing on screen.
      void closeAllPlayerWindows();
      useLibrariesStore.getState().clear();
      resetLibraryCaches();
      useSessionStore.getState().setSettingsOpen(false);
      useSessionStore.getState().setMapOpen(false);
      useSessionStore.getState().setLibraryDialog(null);
    };
  }, []);

  // Switching library (or it locking / unlocking) replaces everything on
  // screen: ids are per library, so nothing cached can carry over.
  useEffect(() => {
    resetLibraryCaches();
    useSessionStore.getState().resetForLibrary();
    if (current !== null && open) {
      void useConversationsStore.getState().refresh();
    }
  }, [current, open]);

  useBackendEvents();
  useThumbnailWorker();
  useIdleLock();

  if (!librariesReady) return <div className="flex h-screen w-screen bg-app" />;

  return (
    <div className="flex h-screen w-screen">
      <Sidebar />
      {lib && !open ? (
        <LibraryLockedView lib={lib} />
      ) : (
        <>
          <ChatList />
          <ChatView />
          <ProfileDrawer />
          <MapView />
        </>
      )}
      <NewConversationDialog />
      <SettingsDialog />
      <CreateLibraryDialog />
      <LibrarySettingsDialog />
      <MoveConversationDialog />
      <RecoveryCodeDialog />
    </div>
  );
}

function resetLibraryCaches() {
  useMessagesStore.getState().reset();
  useConvMediaStore.getState().reset();
  useConversationsStore.getState().reset();
  useSettingsStore.getState().resetLibraryData();
}

function isCurrent(lib: string): boolean {
  return useLibrariesStore.getState().current === lib;
}

function useBackendEvents() {
  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    let cancelled = false;
    const keep = (p: Promise<() => void>) =>
      void p.then((fn) => {
        if (cancelled) fn();
        else unlisteners.push(fn);
      });

    keep(onLibrariesChanged(() => void useLibrariesStore.getState().refresh()));

    keep(
      onConvChanged((payload) => {
        if (!isCurrent(payload.lib)) return;
        void useConversationsStore.getState().refresh();
        // The watcher / volume monitor changed this conversation's media set,
        // so the viewer+grid cache is stale whether or not it is on screen.
        useConvMediaStore.getState().invalidate(payload.convId);
        if (useSessionStore.getState().activeConversationId === payload.convId) {
          void useMessagesStore.getState().load(payload.convId);
        }
      }),
    );

    keep(
      onVolumesChanged((lib) => {
        if (!isCurrent(lib)) return;
        void useConversationsStore.getState().refresh();
        void useSettingsStore.getState().loadVolumes();
        const activeId = useSessionStore.getState().activeConversationId;
        if (activeId !== null) {
          useConvMediaStore.getState().invalidate(activeId);
          void useMessagesStore.getState().load(activeId);
        }
        // Files on the returning volume can be thumbnailed now.
        kickThumbs(lib);
      }),
    );

    // 导入跑在后台线程上，进度靠事件推上来（见 ImportProgressBar）
    keep(onImportProgress((payload) => useImportJobStore.getState().apply(payload)));

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, []);
}

/** Keep the thumbnail worker running for every open library. */
function useThumbnailWorker() {
  const openIds = useLibrariesStore((s) =>
    s.list
      .filter((l) => l.unlocked)
      .map((l) => l.id)
      .join(","),
  );
  useEffect(() => {
    if (!isTauri()) return;
    return startThumbWorker(openIds ? openIds.split(",") : []);
  }, [openIds]);
}

/** Route external links to the OS browser. Without this, clicking an http(s)
 *  link inside the WebView (e.g. the map's OpenStreetMap attribution)
 *  navigates the whole app away with no back button. */
function useExternalLinks() {
  useEffect(() => {
    if (!isTauri()) return;
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      const href = anchor?.getAttribute("href");
      if (href && /^https?:\/\//i.test(href)) {
        e.preventDefault();
        void openUrl(href);
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}

/** Video player popups are separate OS windows; Tauri only exits once every
 *  window is gone. Close them all when the main window is closing. */
function useClosePlayersWithMain() {
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void getCurrentWindow()
      .onCloseRequested(async () => {
        await closeAllPlayerWindows();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
