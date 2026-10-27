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
        const id = await sender.current(text);
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
      <Thread components={components} />
    </AssistantRuntimeProvider>
  );
}
