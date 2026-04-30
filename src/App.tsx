import { Sidebar } from "./components/layout/Sidebar";
import { ChatList } from "./components/layout/ChatList";
import { ChatView } from "./components/layout/ChatView";

export default function App() {
  return (
    <div className="flex h-screen w-screen">
      <Sidebar />
      <ChatList />
      <ChatView />
    </div>
  );
}
