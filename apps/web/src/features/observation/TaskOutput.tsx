import { useMemo } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { AffectTool } from "@/features/chat/AffectTool";
import { toThreadMessages, type PiMessage } from "@/features/chat/store";
import type { TaskDetail } from "./model";
function NoOutput() {
  return (
    <p className="text-sm text-muted-foreground">
      尚无输出。执行状态与记录可在当前调用中查看。
    </p>
  );
}
const components = { Welcome: NoOutput, ToolFallback: AffectTool };
export function TaskOutput({ task }: { task: TaskDetail }) {
  const messages = useMemo(
    () =>
      toThreadMessages(
        task.messages as PiMessage[],
        task.activity === "executing" ? "running" : task.status,
      ),
    [task.messages, task.activity, task.status],
  );
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message) => message,
    isRunning: false,
    isDisabled: true,
    onNew: async () => {
      throw new Error("调用输出为只读。");
    },
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="task-output">
        <Thread components={components} readOnly autoFocus={false} />
      </div>
    </AssistantRuntimeProvider>
  );
}
