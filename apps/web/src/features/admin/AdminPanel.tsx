import { AdminAgentEditor } from "./AdminAgentEditor";
import { ListFilters, emptyFilters, type Filters } from "./ListFilters";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  BookOpen,
  Gauge,
  Settings2,
  Users,
  ListChecks,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { platformRequest } from "@/lib/platform";
import { ModelSettings } from "@/features/models/ModelSettings";
import { PromptSettings } from "@/features/settings/PromptSettings";
import { SkillLibrary } from "@/features/skills/SkillLibrary";
import { TaskReview } from "./TaskReview";
import type { Row, Overview } from "./types";

const sections = [
  ["overview", "概览", Gauge],
  ["users", "用户", Users],
  ["tasks", "任务", ListChecks],
  ["agents", "智能体", Bot],
  ["models", "模型配置", Settings2],
  ["prompts", "提示词", Settings2],
  ["skills", "Skill 管理", BookOpen],
  ["health", "运行状态", Activity],
] as const;
type Section = (typeof sections)[number][0];
const statuses: Record<string, string> = {
  queued: "排队中",
  running: "执行中",
  waiting: "等待中",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
};
export function AdminPanel() {
  const [section, setSection] = useState<Section>("overview");
  const [views, setViews] = useState<
    Partial<Record<Section, { offset: number; filters: Filters }>>
  >({});
  const { offset, filters } = views[section] ?? {
    offset: 0,
    filters: emptyFilters,
  };
  const [editing, setEditing] = useState<string | null>(null);
  function setOffset(value: number) {
    setViews((previous) => ({
      ...previous,
      [section]: { offset: value, filters },
    }));
  }
  function setFilters(value: Filters) {
    setViews((previous) => ({
      ...previous,
      [section]: { offset: 0, filters: value },
    }));
  }
  function drill(next: Section, filters: Filters = emptyFilters) {
    setViews((previous) => ({ ...previous, [next]: { offset: 0, filters } }));
    navigate(next);
  }
  function changeFilters(next: typeof filters) {
    setFilters(next);
  }

  const [task, setTask] = useState<Row | null>(null);
  const overview = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => platformRequest<Overview>("/admin/overview"),
    refetchInterval: 15000,
  });
  const list = useQuery({
    queryKey: ["admin", section, offset, filters],
    enabled: ["users", "tasks", "agents"].includes(section),
    queryFn: ({ signal }) =>
      platformRequest<{ total: number; items: Row[] }>(
        `/admin/${section}?${new URLSearchParams(Object.entries({ offset: String(offset), ...filters }).filter(([key, value]) => value !== "" && !key.endsWith("_label")))}`,
        "GET",
        undefined,
        signal,
      ),
    refetchInterval: section === "tasks" ? 15000 : false,
  });
  function navigate(next: Section) {
    setSection(next);
    setTask(null);
    setEditing(null);
  }
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <nav
        aria-label="管理后台"
        className="flex w-44 shrink-0 flex-col gap-1 border-r bg-muted/20 p-3"
      >
        <p className="px-3 py-3 text-xs font-medium text-muted-foreground">
          平台管理
        </p>
        {sections.map(([key, label, Icon]) => (
          <Button
            key={key}
            variant={section === key ? "secondary" : "ghost"}
            className="justify-start"
            onClick={() => navigate(key)}
          >
            <Icon className="size-4" />
            {label}
          </Button>
        ))}
      </nav>
      <section
        className="flex min-w-0 flex-1 flex-col overflow-auto"
        aria-label={sections.find(([key]) => key === section)?.[1]}
      >
        {editing ? (
          <AdminAgentEditor id={editing} onClose={() => setEditing(null)} />
        ) : task ? (
          <TaskReview key={task.id} task={task} onBack={() => setTask(null)} />
        ) : section === "models" ? (
          <ModelSettings />
        ) : section === "prompts" ? (
          <PromptSettings />
        ) : section === "skills" ? (
          <SkillLibrary />
        ) : (
          <div className="mx-auto w-full max-w-6xl p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold">
                  {sections.find(([key]) => key === section)?.[1]}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {section === "users"
                    ? "查看平台账户与当前权限。"
                    : section === "tasks"
                      ? "查看所有用户的任务，进入详情排查执行过程。"
                      : section === "agents"
                        ? "编辑智能体草稿，或查看它执行过的任务。"
                        : "选择统计项，查看对应记录。"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void overview.refetch();
                  if (["users", "tasks", "agents"].includes(section))
                    void list.refetch();
                }}
              >
                <RefreshCw className="size-4" />
                刷新
              </Button>
            </div>
            {(overview.error || list.error) && (
              <p role="alert" className="mb-4 text-destructive">
                {(overview.error || list.error)?.message}
              </p>
            )}
            {(section === "overview" || section === "health") &&
              (overview.isPending ? (
                <p>正在加载…</p>
              ) : (
                overview.data && (
                  <>
                    {section === "overview" && (
                      <div className="grid grid-cols-4 gap-4">
                        {[
                          ["users", "用户"],
                          ["agents", "智能体"],
                          ["skills", "Skills"],
                          ["tasks", "任务"],
                        ].map(([key, label]) => (
                          <button
                            key={key}
                            onClick={() => drill(key as Section)}
                            className="rounded-xl border bg-card p-5 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                            aria-label={`查看${label}`}
                          >
                            <p className="text-sm text-muted-foreground">
                              {label}
                            </p>
                            <p className="mt-3 text-3xl font-semibold tabular-nums">
                              {overview.data.counts[key]}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                    <h2 className="mb-3 mt-8 font-medium">任务状态</h2>
                    <div className="divide-y rounded-xl border">
                      {Object.entries(overview.data.statuses).map(
                        ([key, count]) => (
                          <button
                            key={key}
                            onClick={() =>
                              drill("tasks", { ...emptyFilters, status: key })
                            }
                            className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                            aria-label={`查看${statuses[key] ?? key}任务`}
                          >
                            <span>{statuses[key] ?? key}</span>
                            <span className="tabular-nums">
                              {count}{" "}
                              <span
                                aria-hidden="true"
                                className="ml-3 text-muted-foreground"
                              >
                                ›
                              </span>
                            </span>
                          </button>
                        ),
                      )}
                      {!Object.keys(overview.data.statuses).length && (
                        <p className="p-5 text-muted-foreground">
                          还没有任务。
                        </p>
                      )}
                    </div>
                    {section === "health" && (
                      <>
                        <button
                          className="mt-6 w-full rounded-xl border p-5 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                          onClick={() =>
                            drill("tasks", {
                              ...emptyFilters,
                              worker: "attached",
                            })
                          }
                        >
                          <h2 className="font-medium">当前执行任务</h2>
                          <p className="mt-2">
                            {overview.data.attached_workers} 个任务{" "}
                            <span className="ml-3 text-sm text-muted-foreground">
                              查看明细 ›
                            </span>
                          </p>
                        </button>
                        <div className="mt-4 flex gap-3">
                          <Button
                            variant="outline"
                            onClick={() => navigate("models")}
                          >
                            前往模型配置
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              drill("tasks", {
                                ...emptyFilters,
                                status: "failed",
                              });
                            }}
                          >
                            查看失败任务
                          </Button>
                        </div>
                      </>
                    )}
                  </>
                )
              ))}
            {["users", "tasks", "agents"].includes(section) && (
              <>
                <ListFilters
                  section={section}
                  value={filters}
                  onChange={changeFilters}
                />
                {list.isPending ? (
                  <p>正在加载…</p>
                ) : (
                  <div className="overflow-auto rounded-xl border">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="p-3">
                            {section === "users" ? "账户" : "名称"}
                          </th>
                          <th className="p-3">
                            {section === "users" ? "角色" : "所属用户"}
                          </th>
                          <th className="p-3">状态</th>
                          <th className="p-3">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.data?.items.map((row) => (
                          <tr
                            key={row.id}
                            className="border-t hover:bg-muted/20"
                          >
                            <td className="max-w-64 break-words p-3">
                              {section === "agents" ? (
                                <button
                                  className="text-left font-medium hover:underline"
                                  onClick={() => setEditing(row.id)}
                                >
                                  {row.name}
                                </button>
                              ) : section === "tasks" ? (
                                <button
                                  className="line-clamp-2 text-left font-medium hover:underline"
                                  onClick={() => setTask(row)}
                                >
                                  {row.title || row.name}
                                </button>
                              ) : (
                                row.email
                              )}
                              {section === "tasks" && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {row.name} ·{" "}
                                  {row.created_at
                                    ? new Date(row.created_at).toLocaleString()
                                    : ""}{" "}
                                  · {row.id.slice(0, 8)}
                                </p>
                              )}
                              {section === "agents" && (
                                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                  {row.description || "尚未填写职责"}
                                  <span className="block">
                                    ID {row.id.slice(0, 8)} ·{" "}
                                    {row.published_version
                                      ? `发布版本 ${row.published_version.slice(0, 8)}`
                                      : "尚未发布"}
                                  </span>
                                </p>
                              )}
                            </td>
                            <td className="p-3">
                              {section === "users"
                                ? row.is_superuser
                                  ? "管理员"
                                  : "普通用户"
                                : row.owner}
                            </td>
                            <td className="whitespace-nowrap p-3">
                              {section === "users"
                                ? row.is_active
                                  ? "已启用"
                                  : "已停用"
                                : (statuses[row.status ?? ""] ?? row.status)}
                            </td>
                            <td className="p-3">
                              {section === "tasks" ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setTask(row)}
                                >
                                  查看详情
                                </Button>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {section === "agents" && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setEditing(row.id)}
                                    >
                                      编辑
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      drill("tasks", {
                                        ...emptyFilters,
                                        ...(section === "agents"
                                          ? {
                                              agent_id: row.id,
                                              agent_label: `${row.name} · ${row.id.slice(0, 8)}`,
                                            }
                                          : {
                                              owner_id: row.id,
                                              owner_label: row.email ?? "",
                                            }),
                                      })
                                    }
                                  >
                                    查看任务
                                  </Button>
                                  {section === "users" && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() =>
                                        drill("agents", {
                                          ...emptyFilters,
                                          owner_id: row.id,
                                          owner_label: row.email ?? "",
                                        })
                                      }
                                    >
                                      查看智能体
                                    </Button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!list.data?.items.length && (
                      <p className="p-8 text-center text-muted-foreground">
                        没有符合条件的记录。
                      </p>
                    )}
                  </div>
                )}
                <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    {list.isPending
                      ? "正在查询…"
                      : list.isError
                        ? "查询失败"
                        : `第 ${Math.floor(offset / 50) + 1}/${Math.max(1, Math.ceil((list.data?.total ?? 0) / 50))} 页 · ${(list.data?.total ?? 0) ? offset + 1 : 0}–${offset + (list.data?.items.length ?? 0)} 条，共 ${list.data?.total ?? 0} 条`}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!offset}
                      onClick={() => setOffset(offset - 50)}
                    >
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset + 50 >= (list.data?.total ?? 0)}
                      onClick={() => setOffset(offset + 50)}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
