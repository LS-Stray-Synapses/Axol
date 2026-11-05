// The fixed shell. Plugins can add things to the slots, but the layout itself,
// the chat, the composer and the approval dialog are not replaceable.

import { useEffect } from "react";
import { mountApprovalDialog } from "./components/ApprovalDialog";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";

export function App() {
  // The approval dialog lives in its own shadow root + React root, outside
  // this tree, so nothing rendered in here (slots included) can reach it.
  useEffect(() => mountApprovalDialog(), []);

  return (
    <div className="flex h-full flex-col">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <ChatView />
          <Composer />
        </main>
      </div>
    </div>
  );
}
