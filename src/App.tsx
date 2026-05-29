import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./components/layout/Sidebar";
import { ChatList } from "./components/layout/ChatList";
import { ChatView } from "./components/layout/ChatView";
import { UnlockScreen } from "./components/layout/UnlockScreen";
import { NewConversationDialog } from "./components/dialogs/NewConversationDialog";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";
import { VaultDialog } from "./components/dialogs/VaultDialog";
import { ConvUnlockDialog } from "./components/dialogs/ConvUnlockDialog";
import { ProfileDrawer } from "./components/profile/ProfileDrawer";
import { onConvChanged, onVolumesChanged } from "./ipc/client";
import { useConversationsStore } from "./stores/conversations";
import { useMessagesStore } from "./stores/messages";
import { useSessionStore } from "./stores/session";
import { useSettingsStore } from "./stores/settings";
import { useVaultStore } from "./stores/vault";
import { isTauri } from "./hooks/useIsTauri";
import { closeAllPlayerWindows } from "./lib/playerWindow";

export default function App() {
  const vaultReady = useVaultStore((s) => s.ready);
  const vaultStatus = useVaultStore((s) => s.status);
  const refreshVault = useVaultStore((s) => s.refresh);

  useEffect(() => {
    void refreshVault();
  }, [refreshVault]);

  // Video player popups are separate OS windows; Tauri only exits once every
  // window is gone. Close them all when the main window is closing so the app
  // process actually terminates.
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

  const locked = vaultStatus.hasMasterPassword && !vaultStatus.unlocked;
  // Gate data-loading on `vaultReady`: until the vault status has actually
  // been fetched, `INITIAL` lies and says hasMasterPassword=false, which
  // would make us fire DB-touching IPCs while the DB is still locked.
  const ready = vaultReady && !locked;

  useEffect(() => {
    if (!ready) return;
    void useSettingsStore.getState().load();
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    let unlistenConv: (() => void) | null = null;
    let unlistenVol: (() => void) | null = null;
    let cancelled = false;

    void onConvChanged((payload) => {
      const refresh = useConversationsStore.getState().refresh;
      void refresh();

      const activeId = useSessionStore.getState().activeConversationId;
      if (activeId === payload.convId) {
        const load = useMessagesStore.getState().load;
        void load(payload.convId);
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenConv = fn;
    });

    void onVolumesChanged(() => {
      void useConversationsStore.getState().refresh();
      void useSettingsStore.getState().loadVolumes();
      const activeId = useSessionStore.getState().activeConversationId;
      if (activeId !== null) {
        void useMessagesStore.getState().load(activeId);
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenVol = fn;
    });

    return () => {
      cancelled = true;
      unlistenConv?.();
      unlistenVol?.();
    };
  }, [ready]);

  if (!vaultReady) {
    return <div className="flex h-screen w-screen bg-app-bg" />;
  }

  if (locked) {
    return <UnlockScreen />;
  }

  return (
    <div className="flex h-screen w-screen">
      <Sidebar />
      <ChatList />
      <ChatView />
      <NewConversationDialog />
      <SettingsDialog />
      <VaultDialog />
      <ConvUnlockDialog />
      <ProfileDrawer />
    </div>
  );
}
