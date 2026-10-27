import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { platformRequest } from "@/lib/platform";
import { useChat } from "@/features/chat/store";
import { DeliveryFiles } from "./Delivery";
import { WorkspaceFiles } from "./WorkspaceFiles";
import { useFiles } from "./files";
type FileItem = { name: string; path: string; size: number };
type FileTask = { id: string; prompt: string; artifacts: FileItem[] };
export function ConversationFiles({ id }: { id: string }) {
  const [legacy, setLegacy] = useState(false);
  const path = useFiles((s) => s.path);
  const running = useChat((s) => s.status === "running");
  const inputs = useQuery({
    queryKey: ["inputs", id],
    queryFn: ({ signal }) =>
      platformRequest<FileItem[]>(
        `/conversations/${id}/inputs`,
        "GET",
        undefined,
        signal,
      ),
  });
  const tasks = useQuery({
    queryKey: ["task-files", id],
    queryFn: ({ signal }) =>
      platformRequest<FileTask[]>(
        `/conversations/${id}/tasks`,
        "GET",
        undefined,
        signal,
      ),
    refetchInterval: running ? 3000 : false,
  });
  if (legacy || path)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Button
          variant="ghost"
          className="shrink-0 self-start"
          onClick={() => {
            setLegacy(false);
            useFiles.setState({ path: null });
          }}
        >
          <ArrowLeft />
          返回材料与成果
        </Button>
        <div className="min-h-0 flex-1">
          <WorkspaceFiles previewOnly={!legacy} />
        </div>
      </div>
    );
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background"
      aria-label="对话文件"
    >
      <header className="flex items-center justify-between border-b p-3">
        <h2 className="text-sm font-medium">材料与成果</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="收起文件"
          onClick={() => useFiles.getState().close()}
        >
          <X />
        </Button>
      </header>
      <div className="flex-1 overflow-auto p-4">
        <Tabs defaultValue="outputs">
          <TabsList aria-label="文件分类">
            <TabsTrigger value="outputs">交付成果</TabsTrigger>
            <TabsTrigger value="inputs">任务材料</TabsTrigger>
          </TabsList>
          <TabsContent value="outputs" className="flex flex-col gap-3">
            {tasks.isLoading && <p role="status">正在读取成果…</p>}
            {tasks.error && (
              <Alert variant="destructive">
                <AlertDescription>{tasks.error.message}</AlertDescription>
                <Button onClick={() => void tasks.refetch()}>重试</Button>
              </Alert>
            )}
            {tasks.data && !tasks.data.some((t) => t.artifacts.length) && (
              <p className="py-6 text-sm text-muted-foreground">
                尚无交付成果。
              </p>
            )}
            {tasks.data
              ?.filter((t) => t.artifacts.length)
              .map((task) => (
                <div key={task.id}>
                  <p className="mb-2 break-words text-xs text-muted-foreground">
                    来自任务：{task.prompt}
                  </p>
                  <DeliveryFiles files={task.artifacts} />
                </div>
              ))}
          </TabsContent>
          <TabsContent value="inputs">
            {inputs.isLoading && <p role="status">正在读取材料…</p>}
            {inputs.error && (
              <Alert variant="destructive">
                <AlertDescription>{inputs.error.message}</AlertDescription>
                <Button onClick={() => void inputs.refetch()}>重试</Button>
              </Alert>
            )}
            {inputs.data?.length ? (
              <DeliveryFiles files={inputs.data} title="任务材料" />
            ) : (
              !inputs.isLoading &&
              !inputs.error && (
                <p className="py-6 text-sm text-muted-foreground">
                  尚未上传材料。可在对话输入框上方添加。
                </p>
              )
            )}
          </TabsContent>
        </Tabs>
        <Button variant="link" className="mt-6" onClick={() => setLegacy(true)}>
          浏览历史工作目录
        </Button>
      </div>
    </section>
  );
}
