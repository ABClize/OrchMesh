import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ConversationFiles } from "./ConversationFiles";
import { WorkspaceFiles } from "./WorkspaceFiles";
import { useFiles } from "./files";

const query = "(min-width: 768px)";
function subscribe(listener: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
export function Workbench({
  children,
  conversationId,
}: {
  children: ReactNode;
  conversationId?: string | null;
}) {
  const desktop = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => true,
  );
  const open = useFiles((s) => s.open);
  useEffect(() => () => useFiles.getState().reset(), []);
  return (
    <div className="workbench min-w-0 flex-1">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel id="chat" minSize="35%" defaultSize="55%">
          {children}
        </ResizablePanel>
        {desktop && open && (
          <>
            <ResizableHandle withHandle aria-label="调整聊天与工作区宽度" />
            <ResizablePanel id="files" minSize="30%" defaultSize="45%">
              {conversationId ? (
                <ConversationFiles key={conversationId} id={conversationId} />
              ) : (
                <WorkspaceFiles />
              )}
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      {!desktop && (
        <Sheet
          open={open}
          onOpenChange={(value) => {
            if (!value) useFiles.getState().close();
          }}
        >
          <SheetContent
            showCloseButton={false}
            className="gap-0 p-0 data-[side=right]:w-full"
          >
            <SheetTitle className="sr-only">文件工作区</SheetTitle>
            <SheetDescription className="sr-only">
              浏览工作目录和已打开的文件
            </SheetDescription>
            {conversationId ? (
              <ConversationFiles key={conversationId} id={conversationId} />
            ) : (
              <WorkspaceFiles />
            )}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
