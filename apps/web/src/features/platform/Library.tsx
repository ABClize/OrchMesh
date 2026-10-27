import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { platformRequest } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AgentEditor } from "./AgentEditor";
import { AgentComments } from "./AgentComments";
import { useCatalogAction, type Agent } from "./catalog";
export function Library({
  onStart,
}: {
  onStart: (agent: string | null, creator?: boolean) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Agent | null>(null);
  const [publishing, setPublishing] = useState<Agent | null>(null);
  const { busy, error, action } = useCatalogAction();
  const mine = useQuery({
    queryKey: ["agents", "mine"],
    queryFn: ({ signal }) =>
      platformRequest<Agent[]>("/agents?mine=true", "GET", undefined, signal),
  });
  const market = useQuery({
    queryKey: ["agents", "market"],
    queryFn: ({ signal }) =>
      platformRequest<Agent[]>("/agents", "GET", undefined, signal),
  });
  return (
    <section className="platform-page">
      <div className="platform-page-inner">
        {editing ? (
          <AgentEditor
            key={editing.id}
            agent={editing}
            onClose={() => setEditing(null)}
          />
        ) : (
          <div className="flex flex-col gap-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-medium">智能体库</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  发现可复用的能力，或创建自己的智能体。
                </p>
              </div>
              <Button
                disabled={busy}
                onClick={() => void action(() => onStart(null, true))}
              >
                创建智能体
              </Button>
            </header>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Tabs defaultValue="market">
              <TabsList aria-label="智能体来源">
                <TabsTrigger value="market">智能体广场</TabsTrigger>
                <TabsTrigger value="mine">我的智能体</TabsTrigger>
              </TabsList>
              {(
                [
                  ["market", market],
                  ["mine", mine],
                ] as const
              ).map(([kind, request]) => (
                <TabsContent
                  key={kind}
                  value={kind}
                  className="flex flex-col gap-4"
                >
                  {request.isLoading && (
                    <p role="status" className="py-8">
                      正在读取智能体…
                    </p>
                  )}
                  {request.error && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        {request.error.message}
                      </AlertDescription>
                      <Button
                        variant="outline"
                        onClick={() => void request.refetch()}
                      >
                        重新读取
                      </Button>
                    </Alert>
                  )}
                  {request.data?.length === 0 && (
                    <p className="py-12 text-sm text-muted-foreground">
                      {kind === "mine"
                        ? "还没有智能体。点击创建，用自然语言描述它的职责。"
                        : "暂无已发布的智能体。"}
                    </p>
                  )}
                  {request.data?.map((agent) => (
                    <Card key={agent.id}>
                      <CardHeader>
                        <CardTitle>{agent.name}</CardTitle>
                        <CardDescription className="whitespace-pre-wrap break-words">
                          {agent.description}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-xs text-muted-foreground">
                          {agent.published_version
                            ? "已有发布版本"
                            : "草稿 · 尚未发布"}
                        </p>
                      </CardContent>
                      <CardFooter className="flex flex-wrap gap-2">
                        {agent.published_version && (
                          <Button
                            disabled={busy}
                            onClick={() => void action(() => onStart(agent.id))}
                          >
                            开始对话
                          </Button>
                        )}
                        {kind === "mine" && (
                          <>
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() => setEditing(agent)}
                            >
                              编辑草稿
                            </Button>
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                void action(() => onStart(`draft:${agent.id}`))
                              }
                            >
                              试运行
                            </Button>
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() => setPublishing(agent)}
                            >
                              发布新版本
                            </Button>
                          </>
                        )}
                      </CardFooter>
                      {kind === "market" && (
                        <CardContent>
                          <details>
                            <summary className="cursor-pointer text-sm">
                              查看评论
                            </summary>
                            <AgentComments agentId={agent.id} />
                          </details>
                        </CardContent>
                      )}
                    </Card>
                  ))}
                </TabsContent>
              ))}
            </Tabs>
          </div>
        )}
        <Dialog
          open={!!publishing}
          onOpenChange={(value) => {
            if (!value && !busy) setPublishing(null);
          }}
        >
          <DialogContent className="max-h-[85dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>确认发布 {publishing?.name}</DialogTitle>
              <DialogDescription>
                先完成草稿试运行，再确认发布。当前草稿将保存为不可变版本，供其他用户调用。
              </DialogDescription>
            </DialogHeader>
            <p className="whitespace-pre-wrap break-words text-sm">
              {publishing?.draft.instructions}
            </p>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button
              disabled={busy}
              onClick={() => {
                if (publishing)
                  void action(async () => {
                    await platformRequest(
                      `/agents/${publishing.id}/publish`,
                      "POST",
                      { confirm: true },
                    );
                    setPublishing(null);
                  });
              }}
            >
              确认发布
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}
