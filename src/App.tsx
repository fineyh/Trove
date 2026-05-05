import { useEffect } from "react";
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

export default function App() {
  const vaultReady = useVaultStore((s) => s.ready);
  const vaultStatus = useVaultStore((s) => s.status);
  const refreshVault = useVaultStore((s) => s.refresh);

  useEffect(() => {
    void refreshVault();
  }, [refreshVault]);

  const locked = vaultStatus.hasMasterPassword && !vaultStatus.unlocked;

  useEffect(() => {
    if (locked) return;
    void useSettingsStore.getState().load();
  }, [locked]);

  useEffect(() => {
    if (locked) return;
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
  }, [locked]);

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
