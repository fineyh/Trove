import { Sidebar } from "./components/layout/Sidebar";
import { ChatList } from "./components/layout/ChatList";
import { ChatView } from "./components/layout/ChatView";
import { NewConversationDialog } from "./components/dialogs/NewConversationDialog";
import { ProfileDrawer } from "./components/profile/ProfileDrawer";

export default function App() {
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
