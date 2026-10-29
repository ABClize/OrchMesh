import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentGraph } from "@/features/observation/hooks";
import { scopeGraph } from "@/features/observation/model";
import {
  ObservationWorkspace,
  type Selection,
} from "@/features/observation/ObservationWorkspace";
import type { Row } from "./types";

export function TaskReview({
  task,
  onBack,
}: {
  task: Row;
  onBack: () => void;
}) {
  const graph = useAgentGraph(task.conversation_id!, true);
  const [selection, setSelection] = useState<Selection>({
    kind: "task",
    id: task.id,
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b p-3">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft />
          返回任务列表
        </Button>
        <span className="text-sm text-muted-foreground">
          {task.owner} · 只读查看
        </span>
      </div>
      {graph.error && (
        <p role="alert" className="p-4 text-destructive">
          {graph.error}
        </p>
      )}
      {graph.connection === "connecting" && !graph.data.calls.length ? (
        <p className="p-6">正在加载任务…</p>
      ) : (
        <ObservationWorkspace
          graph={scopeGraph(
            graph.data,
            graph.data.calls.find((call) => call.id === task.id)?.root_id ??
              null,
          )}
          readOnly
          active
          selection={selection}
          onSelect={setSelection}
        />
      )}
    </div>
  );
}
