import { useEffect, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ThreadMessage,
} from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createDraftSender } from "./commands";
import { Welcome, suggestions } from "./Welcome";

const messages: ThreadMessage[] = [];
const components = { Welcome };

export function DraftChat({
  projectId,
  onStarted,
  onBusyChange,
}: {
  projectId?: string | null;
  onStarted: (id: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  // Retain the newly created conversation if sending fails: retry must not
  // create another empty conversation. Sending is only triggered by the user.
  const sender = useRef(createDraftSender(projectId));
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [reviewTools, setReviewTools] = useState(true);
  const [error, setError] = useState("");
  const runtime = useExternalStoreRuntime({
    messages,
    suggestions,
    onNew: async (message) => {
      const text = message.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      setError("");
      onBusyChange(true);
      try {
        const id = await sender.current(text, reviewTools);
        if (mounted.current) onStarted(id);
      } catch (cause) {
        if (mounted.current) setError((cause as Error).message);
        throw cause;
      } finally {
        if (mounted.current) onBusyChange(false);
      }
    },
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <label className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 pt-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={reviewTools}
          onChange={(e) => setReviewTools(e.target.checked)}
        />
        本轮工具审批（每次执行前确认）
      </label>
      <Thread components={components} />
    </AssistantRuntimeProvider>
  );
}
