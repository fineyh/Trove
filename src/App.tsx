import { useEffect } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { ChatList } from "./components/layout/ChatList";
import { ChatView } from "./components/layout/ChatView";
import { NewConversationDialog } from "./components/dialogs/NewConversationDialog";
import { ProfileDrawer } from "./components/profile/ProfileDrawer";
import { onConvChanged } from "./ipc/client";
import { useConversationsStore } from "./stores/conversations";
import { useMessagesStore } from "./stores/messages";
import { useSessionStore } from "./stores/session";

export default function App() {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
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
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className="flex h-screen w-screen">
      <Sidebar />
      <ChatList />
      <ChatView />
      <NewConversationDialog />
      <ProfileDrawer />
    </div>
  );
}
