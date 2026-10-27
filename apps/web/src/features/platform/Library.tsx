import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { platformRequest } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { Plus, Search, Bot } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentCard } from "./AgentCard";
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
  const [search, setSearch] = useState("");
  const [comments, setComments] = useState<Agent | null>(null);
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
      <div className="platform-page-inner agent-library">
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
                <Plus data-icon="inline-start" />
                创建智能体
              </Button>
            </header>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Tabs defaultValue="market">
              <div className="agent-library-toolbar">
                <TabsList aria-label="智能体来源">
                  <TabsTrigger value="market">智能体广场</TabsTrigger>
                  <TabsTrigger value="mine">我的智能体</TabsTrigger>
                </TabsList>
                <div className="agent-library-search">
                  <Search aria-hidden="true" />
                  <Input
                    aria-label="搜索智能体"
                    placeholder="搜索名称或简介…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
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
                    <div
                      role="status"
                      aria-label="正在读取智能体"
                      className="agent-library-grid"
                    >
                      <Skeleton className="h-56" />
                      <Skeleton className="h-56" />
                    </div>
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
                  {request.data && (
                    <>
                      <p
                        className="text-xs text-muted-foreground"
                        role="status"
                      >
                        {
                          request.data.filter((agent) =>
                            `${agent.name} ${agent.description}`
                              .toLowerCase()
                              .includes(search.trim().toLowerCase()),
                          ).length
                        }{" "}
                        个智能体{search.trim() ? "符合搜索" : ""}
                      </p>
                      <div className="agent-library-grid">
                        {request.data
                          .filter((agent) =>
                            `${agent.name} ${agent.description}`
                              .toLowerCase()
                              .includes(search.trim().toLowerCase()),
                          )
                          .map((agent) => (
                            <AgentCard
                              key={agent.id}
                              agent={agent}
                              mine={kind === "mine"}
                              busy={busy}
                              onStart={(draft) =>
                                void action(() =>
                                  onStart(
                                    draft ? `draft:${agent.id}` : agent.id,
                                  ),
                                )
                              }
                              onEdit={() => setEditing(agent)}
                              onPublish={() => setPublishing(agent)}
                              onComments={() => setComments(agent)}
                            />
                          ))}
                      </div>
                      {!request.data.some((agent) =>
                        `${agent.name} ${agent.description}`
                          .toLowerCase()
                          .includes(search.trim().toLowerCase()),
                      ) && (
                        <div className="agent-library-empty">
                          <Bot aria-hidden="true" />
                          <p>
                            {search.trim()
                              ? "没有找到匹配的智能体"
                              : kind === "mine"
                                ? "还没有自己的智能体"
                                : "暂无已发布的智能体"}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {search.trim()
                              ? "换个关键词，或清空搜索查看全部。"
                              : "用自然语言描述职责，即可开始创建。"}
                          </p>
                          {search.trim() && (
                            <Button
                              variant="outline"
                              onClick={() => setSearch("")}
                            >
                              清空搜索
                            </Button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </div>
        )}
        <Dialog
          open={!!comments}
          onOpenChange={(open) => {
            if (!open) setComments(null);
          }}
        >
          <DialogContent className="max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{comments?.name} · 评论</DialogTitle>
              <DialogDescription>查看使用反馈与讨论。</DialogDescription>
            </DialogHeader>
            {comments && <AgentComments agentId={comments.id} />}
          </DialogContent>
        </Dialog>
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
