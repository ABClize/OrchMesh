import { revealPath } from "@/components/agent-tree/forest";
import { CallTree } from "./CallTree";
import { AnimatedDisclosure } from "@/components/relationship-diagram/AnimatedDisclosure";
import "./observation.css";
import { ObservationStatus } from "./ObservationStatus";
import { useState } from "react";
import { AgentRelations } from "./AgentRelations";
import { ArrowLeft, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { CallInspector } from "./CallInspector";
import { countsLabel, formatTime, scopeGraph, type AgentGraph } from "./model";
export type Selection = { kind: "node" | "edge" | "task"; id: string } | null;
export function ObservationWorkspace({
  graph,
  readOnly,
  selection,
  onSelect,
  active,
}: {
  active: boolean;
  graph: AgentGraph;
  readOnly: boolean;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const [scope, setScope] = useState("latest");
  const [mode, setMode] = useState("tree");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [chosenCall, setChosenCall] = useState<string | null>(null);

  const desktop = useMediaQuery("(min-width: 768px)");
  const roots = graph.calls.filter((c) => !c.parent_id);
  const rootId =
    scope === "all"
      ? null
      : scope === "latest"
        ? (roots.at(-1)?.id ?? null)
        : scope;
  const scoped = scopeGraph(graph, rootId);
  const visibleCollapsed = revealPath(
    scoped.calls.map((call) => ({ id: call.id, parentId: call.parent_id })),
    collapsed,
    selection?.kind === "task" ? selection.id : null,
  );
  const object =
    selection?.kind === "node"
      ? scoped.nodes.find((n) => n.id === selection.id)
      : selection?.kind === "edge"
        ? scoped.edges.find((e) => e.id === selection.id)
        : null;
  const selectedCalls =
    selection?.kind === "task"
      ? graph.calls.filter((c) => c.id === selection.id)
      : scoped.calls.filter((c) => object?.task_ids.includes(c.id));
  const taskId =
    selectedCalls.find((c) => c.id === chosenCall)?.id ??
    (selection?.kind === "task" ? selectedCalls[0]?.id : null);
  const inspecting = !!selection;
  const select = (kind: "node" | "edge", id: string) => {
    setChosenCall(null);
    onSelect(
      selection?.kind === kind && selection.id === id ? null : { kind, id },
    );
  };
  const callDetail =
    taskId && active ? (
      <CallInspector
        key={taskId}
        taskId={taskId}
        calls={graph.calls}
        readOnly={readOnly}
        onSelect={(id) => {
          setChosenCall(null);
          onSelect({ kind: "task", id });
        }}
      />
    ) : null;
  const inspector = inspecting ? (
    <aside className="observation-inspector">
      <div className="mb-1 flex items-center justify-between">
        {desktop ? (
          <span className="text-xs text-muted-foreground">
            {selection?.kind === "edge"
              ? "此方向"
              : selection?.kind === "task"
                ? "所选调用"
                : "所选智能体"}{" "}
            · {selectedCalls.length} 次调用
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!desktop && taskId && selection?.kind !== "task")
                setChosenCall(null);
              else onSelect(null);
            }}
          >
            <ArrowLeft />
            {!desktop && taskId && selection?.kind !== "task"
              ? "返回调用列表"
              : "返回协作"}
          </Button>
        )}
        {desktop && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="关闭调用详情"
            onClick={() => onSelect(null)}
          >
            <X />
          </Button>
        )}
      </div>
      {!selectedCalls.length && (
        <p className="text-sm text-muted-foreground">
          所选记录不在当前范围内，请返回协作重新选择。
        </p>
      )}
      {selection?.kind !== "task" && (desktop || !taskId) && (
        <div className="observation-call-list">
          {selectedCalls.map((call, i) => (
            <div key={call.id} className="observation-call-item">
              <button
                type="button"
                className="observation-call-choice"
                aria-expanded={taskId === call.id}
                onClick={() =>
                  setChosenCall(taskId === call.id ? null : call.id)
                }
              >
                <ChevronDown
                  className="observation-disclosure"
                  size={14}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="observation-call-title">
                    调用 {i + 1} · {call.name}
                  </span>
                  <span className="observation-call-prompt">{call.prompt}</span>
                </span>
                <time className="observation-call-time">
                  {formatTime(call.created_at)}
                </time>
                <ObservationStatus activity={call.activity} />
              </button>
              <AnimatedDisclosure open={desktop && taskId === call.id}>
                {callDetail}
              </AnimatedDisclosure>
            </div>
          ))}
        </div>
      )}
      {(selection?.kind === "task" || !desktop) && callDetail}
    </aside>
  ) : null;
  return (
    <section className="observation-workspace" aria-label="协作工作空间">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <label className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          观察范围
          <NativeSelect
            className="max-w-72"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
              onSelect(null);
              setChosenCall(null);
            }}
          >
            <NativeSelectOption value="latest">最新运行</NativeSelectOption>
            <NativeSelectOption value="all">
              当前对话的全部运行
            </NativeSelectOption>
            {roots.map((call, i) => (
              <NativeSelectOption key={call.id} value={call.id}>
                运行 {i + 1} · {formatTime(call.created_at)} ·{" "}
                {call.prompt.slice(0, 30)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {desktop && (
          <Tabs value={mode} onValueChange={setMode}>
            <TabsList aria-label="协作展示方式">
              <TabsTrigger value="tree">调用树</TabsTrigger>
              <TabsTrigger value="graph">聚合关系图</TabsTrigger>
              <TabsTrigger value="list">列表</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>
      <div className="observation-content">
        {(desktop || !inspecting) && (
          <div className="min-w-0">
            <p className="mb-3 text-xs text-muted-foreground">
              {scoped.nodes.length} 个智能体 · {scoped.calls.length} 次调用
            </p>
            {!scoped.calls.length ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                尚无运行记录。发送任务后，可在这里查看协作过程。
              </p>
            ) : mode === "tree" && desktop && active ? (
              <CallTree
                calls={scoped.calls}
                collapsed={visibleCollapsed}
                selected={selection?.kind === "task" ? selection.id : null}
                onSelect={(id) => {
                  setChosenCall(null);
                  onSelect(
                    selection?.kind === "task" && selection.id === id
                      ? null
                      : { kind: "task", id },
                  );
                }}
                onToggle={(id, descendants) => {
                  const closing = !visibleCollapsed.has(id);
                  setCollapsed(() => {
                    const next = new Set(visibleCollapsed);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                  if (
                    closing &&
                    selection?.kind === "task" &&
                    descendants.includes(selection.id)
                  )
                    onSelect(null);
                }}
              />
            ) : mode === "graph" && active ? (
              <AgentRelations
                graph={scoped}
                selected={selection?.id ?? null}
                onSelect={select}
                details={desktop ? inspector : null}
              />
            ) : (
              <div className="flex flex-col gap-3">
                {scoped.nodes.map((node) => (
                  <Button
                    key={node.id}
                    variant={
                      selection?.id === node.id ? "secondary" : "outline"
                    }
                    className="h-auto justify-start whitespace-normal py-4 text-left"
                    onClick={() => select("node", node.id)}
                  >
                    <span className="min-w-0 break-words">
                      <span className="block font-medium">{node.name}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {node.call_count} 次调用 ·{" "}
                        {countsLabel(node.activity_counts)}
                      </span>
                    </span>
                  </Button>
                ))}
                {!!scoped.edges.length && (
                  <details>
                    <summary className="cursor-pointer py-2 text-sm">
                      调用关系
                    </summary>
                    {scoped.edges.map((edge) => (
                      <Button
                        key={edge.id}
                        variant="ghost"
                        className="h-auto w-full justify-start whitespace-normal text-left"
                        onClick={() => select("edge", edge.id)}
                      >
                        {scoped.nodes.find((n) => n.id === edge.source)?.name} →{" "}
                        {scoped.nodes.find((n) => n.id === edge.target)?.name} ·{" "}
                        {edge.call_count} 次
                      </Button>
                    ))}
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {(mode !== "graph" || !desktop) && inspector}
      </div>
    </section>
  );
}
