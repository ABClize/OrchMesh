import { Clock3, FileText, ListTree, MessageSquare } from "lucide-react";
import { ObservationStatus } from "./ObservationStatus";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DeliveryFiles } from "@/features/workspace/Delivery";
import { useTaskObservation } from "./hooks";
import { formatTime, pendingDependencies, type Call } from "./model";
import { FeedNotice, LoadingObservation } from "./Feedback";
import { TaskQuestions } from "./TaskQuestions";
import { TaskOutput } from "./TaskOutput";
import { ExecutionHistory } from "./ExecutionHistory";
export function CallInspector({
  taskId,
  calls,
  readOnly,
  onSelect,
}: {
  taskId: string;
  calls: Call[];
  readOnly: boolean;
  onSelect: (id: string) => void;
}) {
  const feed = useTaskObservation(taskId);
  const task = feed.data;
  const waitingFor = task ? pendingDependencies(task, calls) : [];
  return (
    <section
      aria-label="调用详情"
      className="observation-call-detail flex min-w-0 flex-col gap-3"
    >
      <FeedNotice {...feed} />
      {!task && feed.connection !== "error" && <LoadingObservation />}
      {task && (
        <>
          <div className="observation-call-header">
            <div className="observation-node-heading">
              <div className="min-w-0">
                <span className="observation-eyebrow">调用详情</span>
                <h3 className="font-medium break-words">{task.name}</h3>
              </div>
            </div>
            <div className="mt-1">
              <ObservationStatus activity={task.activity} />
            </div>
            <details className="observation-goal mt-2 text-sm">
              <summary className="cursor-pointer break-words">
                任务目标：
                {task.prompt.length > 90
                  ? `${task.prompt.slice(0, 90)}…`
                  : task.prompt}
              </summary>
              <p className="mt-2 whitespace-pre-wrap break-words">
                {task.prompt}
              </p>
            </details>
            <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock3 size={12} aria-hidden="true" />
              创建于 {formatTime(task.created_at)}
            </p>
          </div>
          {task.activity === "resuming_or_transitioning" && (
            <p className="text-sm text-muted-foreground">
              暂时没有实时输出，正在等待执行状态更新。
            </p>
          )}
          {task.error && (
            <Alert variant="destructive">
              <AlertDescription>{task.error}</AlertDescription>
            </Alert>
          )}
          {task.parent_id && (
            <Button
              variant="link"
              className="justify-start"
              onClick={() => onSelect(task.parent_id!)}
            >
              上级调用：
              {calls.find((c) => c.id === task.parent_id)?.name ?? "查看"}
            </Button>
          )}
          {!!waitingFor.length && (
            <div className="flex flex-col items-start gap-1">
              <p className="text-sm text-muted-foreground">正在等待</p>
              {waitingFor.map((id) => (
                <Button key={id} variant="link" onClick={() => onSelect(id)}>
                  {calls.find((c) => c.id === id)?.name ?? "查看依赖调用"}
                </Button>
              ))}
            </div>
          )}
          <TaskQuestions task={task} readOnly={readOnly} />
          <Tabs defaultValue="output" className="min-w-0">
            <TabsList aria-label="调用内容">
              <TabsTrigger value="output">
                <MessageSquare aria-hidden="true" />
                输出
              </TabsTrigger>
              <TabsTrigger value="history">
                <ListTree aria-hidden="true" />
                执行记录
              </TabsTrigger>
              <TabsTrigger value="files">
                <FileText aria-hidden="true" />
                文件
              </TabsTrigger>
            </TabsList>
            <TabsContent value="output">
              <TaskOutput task={task} />
            </TabsContent>
            <TabsContent value="history">
              <ExecutionHistory
                events={feed.history}
                onSelectTask={onSelect}
                activity={task.activity}
                available={feed.available}
                live={
                  feed.connection === "live" &&
                  ["running", "waiting", "queued"].includes(task.status)
                }
                running={task.activity === "executing"}
              />
            </TabsContent>
            <TabsContent value="files">
              {task.artifacts.length ? (
                <DeliveryFiles
                  files={task.artifacts.flatMap((file) =>
                    typeof file.name === "string" &&
                    typeof file.path === "string"
                      ? [
                          {
                            name: file.name,
                            path: file.path,
                            size:
                              typeof file.size === "number"
                                ? file.size
                                : undefined,
                          },
                        ]
                      : [],
                  )}
                />
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  尚无交付文件。
                </p>
              )}
            </TabsContent>
          </Tabs>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">技术信息</summary>
            <dl className="mt-2 flex flex-col gap-1 break-all">
              <dt>调用 ID</dt>
              <dd>{task.id}</dd>
              <dt>绑定版本</dt>
              <dd>{task.version_id ?? "未提供"}</dd>
            </dl>
          </details>
        </>
      )}
    </section>
  );
}
