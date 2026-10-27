import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Connection } from "./stream";
export function FeedNotice({
  connection,
  error,
  retry,
}: {
  connection: Connection;
  error?: string;
  retry: () => void;
}) {
  if (connection !== "error" && connection !== "reconnecting") return null;
  return (
    <Alert variant={connection === "error" ? "destructive" : "default"}>
      <AlertDescription>
        {connection === "reconnecting"
          ? "连接中断，正在重连。已显示的内容会保留，任务状态以重新连接后的记录为准。"
          : error || "暂时无法读取记录。"}
      </AlertDescription>
      {connection === "error" && (
        <Button variant="outline" size="sm" onClick={retry}>
          重新连接
        </Button>
      )}
    </Alert>
  );
}
export function LoadingObservation() {
  return (
    <div role="status" className="flex flex-col gap-3 p-4">
      <span className="text-sm text-muted-foreground">正在读取记录…</span>
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}
