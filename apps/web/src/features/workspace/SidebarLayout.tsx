import { useSyncExternalStore, type ReactNode } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useFiles } from "./files";

function subscribe(listener: () => void) {
  const queries = [
    window.matchMedia("(min-width: 768px)"),
    window.matchMedia("(min-width: 1200px)"),
  ];
  queries.forEach((query) => query.addEventListener("change", listener));
  return () =>
    queries.forEach((query) => query.removeEventListener("change", listener));
}
function getSize() {
  return window.matchMedia("(min-width: 1200px)").matches
    ? "wide"
    : window.matchMedia("(min-width: 768px)").matches
      ? "desktop"
      : "mobile";
}
export function SidebarLayout({
  sidebar,
  children,
  showConversations,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  showConversations: boolean;
}) {
  const size = useSyncExternalStore(subscribe, getSize, () => "wide");
  const open = useFiles((state) => state.open);
  const visible =
    size === "wide" ||
    (size === "desktop" ? !open || showConversations : showConversations);
  return (
    <div className="flex h-full min-w-0 flex-1">
      {size === "mobile" && visible && sidebar}
      <ResizablePanelGroup
        orientation="horizontal"
        className={size === "mobile" && visible ? "hidden" : ""}
      >
        {visible && size !== "mobile" && (
          <>
            <ResizablePanel
              id="navigation"
              defaultSize={244}
              minSize={180}
              maxSize="35%"
            >
              {sidebar}
            </ResizablePanel>
            {<ResizableHandle withHandle aria-label="调整会话列表宽度" />}
          </>
        )}
        <ResizablePanel
          id="workbench"
          minSize="50%"
          className={size === "mobile" && showConversations ? "hidden" : ""}
        >
          {children}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
