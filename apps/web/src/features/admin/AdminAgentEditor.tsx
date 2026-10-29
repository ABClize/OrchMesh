import { useQuery } from "@tanstack/react-query";
import { AgentEditor } from "@/features/platform/AgentEditor";
import type { Agent } from "@/features/platform/catalog";
import { platformRequest } from "@/lib/platform";
import { Button } from "@/components/ui/button";
export function AdminAgentEditor({
  id,
  onClose,
  backLabel = "返回智能体列表",
}: {
  id: string;
  backLabel?: string;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["agents", "edit", id],
    queryFn: ({ signal }) =>
      platformRequest<Agent>(
        `/agents/${encodeURIComponent(id)}`,
        "GET",
        undefined,
        signal,
      ),
  });
  return (
    <div className="p-6">
      {query.isPending ? (
        <p>正在读取智能体…</p>
      ) : query.error ? (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            重试
          </Button>
          <Button variant="ghost" onClick={onClose}>
            返回列表
          </Button>
        </div>
      ) : (
        <AgentEditor
          key={id}
          agent={query.data}
          onClose={onClose}
          backLabel={backLabel}
        />
      )}
    </div>
  );
}
