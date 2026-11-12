import { useEffect, useState } from "react";
import { callOperation } from "./backend";
import { mountApprovalDialog } from "./components/ApprovalDialog";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";

type Tab =
  | { kind: "chat" }
  | { kind: "file"; file: string };

function WorkspaceViewer({ file }: { file: string }) {
  const [content, setContent] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await callOperation("workspace.read", { path: file });
      if (!cancelled) {
        setContent(typeof result === "string" ? result : "");
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [file]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-2xl font-semibold text-fg">{file}</div>
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("workspace.close"));
          }}
          className="rounded border border-border px-2 py-1 text-sm text-muted hover:text-fg"
        >
          close
        </button>
      </div>

      <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-fg">
        {content}
      </pre>
    </div>
  );
}

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([{ kind: "chat" }]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const open = (event: Event) => {
      const file = (event as CustomEvent<{ file: string }>).detail?.file;
      if (!file) return;

      setTabs((prev) => {
        const exists = prev.some((tab) => tab.kind === "file" && tab.file === file);
        if (exists) {
          const idx = prev.findIndex((tab) => tab.kind === "file" && tab.file === file);
          setActiveIndex(idx);
          return prev;
        }

        const next: Tab[] = [...prev, { kind: "file", file }];
        setActiveIndex(next.length - 1);
        return next;
      });
    };

    const close = () => {
      setTabs((prev) => {
        const next = prev.filter((_, idx) => idx !== activeIndex);
        return next.length > 0 ? next : [{ kind: "chat" }];
      });

      setActiveIndex((prev) => {
        if (prev <= 0) return 0;
        return prev - 1;
      });
    };

    window.addEventListener("workspace.open", open as EventListener);
    window.addEventListener("workspace.close", close as EventListener);

    return () => {
      window.removeEventListener("workspace.open", open as EventListener);
      window.removeEventListener("workspace.close", close as EventListener);
    };
  }, [activeIndex]);

  useEffect(() => mountApprovalDialog(), []);

  const activeTab = tabs[activeIndex] ?? { kind: "chat" as const };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
          {tabs.length > 1 && (
            <div className="flex shrink-0 border-b border-border bg-bg/40">
              {tabs.map((tab, index) => (
                <button
                  key={tab.kind === "chat" ? "chat" : tab.file}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className={
                    "px-4 py-2 text-sm " +
                    (index === activeIndex ? "border-b-2 border-accent text-fg" : "text-muted")
                  }
                >
                  {tab.kind === "chat" ? "Chat" : tab.file}
                </button>
              ))}
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {activeTab.kind === "chat" ? (
              <>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <ChatView />
                </div>
                <Composer />
              </>
            ) : (
              <WorkspaceViewer file={activeTab.file} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}