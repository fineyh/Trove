import { useEffect } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { ChatList } from "./components/layout/ChatList";
import { ChatView } from "./components/layout/ChatView";
import { NewConversationDialog } from "./components/dialogs/NewConversationDialog";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";
import { ProfileDrawer } from "./components/profile/ProfileDrawer";
import { onConvChanged, onVolumesChanged } from "./ipc/client";
import { useConversationsStore } from "./stores/conversations";
import { useMessagesStore } from "./stores/messages";
import { useSessionStore } from "./stores/session";
import { useSettingsStore } from "./stores/settings";

export default function App() {
  useEffect(() => {
    void useSettingsStore.getState().load();
  }, []);

  useEffect(() => {
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
  }, []);

  return (
    <div className="flex h-screen w-screen">
      <Sidebar />
      <ChatList />
      <ChatView />
      <NewConversationDialog />
      <SettingsDialog />
      <ProfileDrawer />
    </div>
  );
}
