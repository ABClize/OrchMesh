import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Folder,
  FolderPlus,
  Pin,
  PinOff,
  MoreHorizontal,
  Pencil,
  GitBranch,
  FolderX,
} from "lucide-react";
import { api } from "@/lib/api";
import type { components } from "@/lib/api-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

type Conversation = components["schemas"]["ConversationRead"];
type Project = components["schemas"]["ProjectRead"];
export function Navigation({
  archived,
  setArchived,
  conversations,
  id,
  projectId,
  busy,
  onSelect,
  onProject,
  onArchive,
}: {
  archived: boolean;
  setArchived: (value: boolean) => void;
  conversations: Conversation[];
  id: string | null;
  projectId: string | null;
  busy: boolean;
  onSelect: (conversation: Conversation) => void;
  onProject: (id: string | null) => void;
  onArchive: (id: string) => void;
}) {
  const query = useQueryClient();
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [renaming, setRenaming] = useState<Conversation | null>(null);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/projects", { signal });
      if (error || !data) throw new Error("项目加载失败");
      return data;
    },
  });
  const saveProject = useMutation({
    mutationFn: async ({
      project,
      name,
    }: {
      project: Project | "new";
      name?: string;
    }) => {
      const result =
        project === "new"
          ? await api.POST("/api/projects", { body: { name: name! } })
          : await api.PATCH("/api/projects/{project_id}", {
              params: { path: { project_id: project.id } },
              body: { name: name! },
            });
      if (result.error || !result.data)
        throw new Error("项目更新失败，请检查名称是否重复。");
      return result.data;
    },
    onSuccess: async (project, variables) => {
      await query.invalidateQueries({ queryKey: ["projects"] });
      await query.invalidateQueries({ queryKey: ["conversations"] });
      setEditing(null);
      if (variables.project === "new") {
        setArchived(false);
        onProject(project.id);
      }
    },
  });
  const update = useMutation({
    mutationFn: async ({
      conversation,
      change,
    }: {
      conversation: Conversation;
      change: components["schemas"]["ConversationUpdate"];
    }) => {
      const { data, error } = await api.PATCH(
        "/api/conversations/{conversation_id}",
        {
          params: { path: { conversation_id: conversation.id } },
          body: change,
        },
      );
      if (error || !data)
        throw new Error("更新失败，请等待当前任务结束后重试。");
      return data;
    },
    onSuccess: async (conversation, { change }) => {
      await query.invalidateQueries({ queryKey: ["conversations"] });
      if (change.archived) onArchive(conversation.id);
      setRenaming(null);
    },
  });
  const removeProject = useMutation({
    mutationFn: async (project: Project) => {
      const { error } = await api.DELETE("/api/projects/{project_id}", {
        params: { path: { project_id: project.id } },
      });
      if (error) throw new Error("移除项目失败，请等待当前任务结束后重试。");
      return project;
    },
    onSuccess: async (project) => {
      await query.invalidateQueries({ queryKey: ["projects"] });
      await query.invalidateQueries({ queryKey: ["conversations"] });
      if (projectId === project.id) onProject(null);
    },
  });
  const fork = useMutation({
    mutationFn: async (conversation: Conversation) => {
      const { data, error } = await api.POST(
        "/api/conversations/{conversation_id}/fork",
        { params: { path: { conversation_id: conversation.id } } },
      );
      if (error || !data)
        throw new Error("创建分支失败：需要至少一轮已完成的对话。");
      return data;
    },
    onSuccess: async (conversation) => {
      await query.invalidateQueries({ queryKey: ["conversations"] });
      setArchived(false);
      onSelect(conversation);
    },
  });
  const visible = conversations
    .filter((c) => c.project_id === projectId && c.archived === archived)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.created_at.localeCompare(a.created_at),
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between px-2">
        <span className="text-xs text-muted-foreground">项目</span>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            aria-label="新建项目"
            disabled={busy}
            onClick={() => {
              saveProject.reset();
              setEditing("new");
            }}
          >
            <FolderPlus />
          </Button>
        </div>
      </div>
      <nav
        aria-label="项目列表"
        className="flex max-h-48 shrink-0 flex-col gap-1 overflow-auto"
      >
        <Button
          variant={projectId === null ? "secondary" : "ghost"}
          className="justify-start"
          disabled={busy}
          onClick={() => onProject(null)}
        >
          <Folder />
          未分组
        </Button>
        {projects.data?.map((project) => (
          <div key={project.id} className="group flex min-w-0 items-center">
            <Button
              variant={projectId === project.id ? "secondary" : "ghost"}
              className="min-w-0 flex-1 justify-start"
              title={project.name}
              disabled={busy}
              onClick={() => {
                setArchived(false);
                onProject(project.id);
              }}
            >
              <Folder />
              <span className="truncate">{project.name}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={"项目操作：" + project.name}
                  disabled={saveProject.isPending}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onSelect={() => {
                      saveProject.reset();
                      setEditing(project);
                    }}
                  >
                    <Pencil />
                    重命名
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={busy || removeProject.isPending}
                    onSelect={() => removeProject.mutate(project)}
                  >
                    <FolderX />
                    移除项目（保留文件和会话）
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </nav>
      <div className="flex items-center justify-between px-2">
        <span className="text-xs text-muted-foreground">
          {archived ? "已归档会话" : "会话 · 置顶优先"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => setArchived(!archived)}
        >
          {archived ? "返回会话" : "已归档"}
        </Button>
      </div>
      {(projects.error || update.error || saveProject.error) && (
        <p role="alert" className="text-sm">
          {projects.error?.message ??
            update.error?.message ??
            saveProject.error?.message}
        </p>
      )}
      <nav
        aria-label="对话列表"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto"
      >
        {visible.map((c) => (
          <div key={c.id} className="group flex min-w-0 items-center">
            <Button
              variant={id === c.id ? "secondary" : "ghost"}
              className="conversation-item min-w-0 flex-1 justify-start"
              title={c.title}
              disabled={busy && id !== c.id}
              onClick={() => onSelect(c)}
            >
              {c.pinned && <Pin />}
              <span className="truncate">{c.title}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={"对话操作：" + c.title}
                  disabled={update.isPending}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  {!c.archived && (
                    <DropdownMenuItem
                      onSelect={() =>
                        update.mutate({
                          conversation: c,
                          change: { pinned: !c.pinned },
                        })
                      }
                    >
                      {c.pinned ? <PinOff /> : <Pin />}
                      {c.pinned ? "取消置顶" : "置顶"}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => {
                      update.reset();
                      setRenaming(c);
                    }}
                  >
                    <Pencil />
                    重命名对话
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={busy || fork.isPending}
                    onSelect={() => fork.mutate(c)}
                  >
                    <GitBranch />
                    从已完成的对话创建分支
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() =>
                      update.mutate({
                        conversation: c,
                        change: { archived: !c.archived },
                      })
                    }
                  >
                    {c.archived ? <ArchiveRestore /> : <Archive />}
                    {c.archived ? "恢复对话" : "归档对话"}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
        {!visible.length && (
          <p className="px-2 text-sm text-muted-foreground">
            暂无{archived ? "归档" : ""}会话
          </p>
        )}
      </nav>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing === "new" ? "新建项目" : "重命名项目"}
            </DialogTitle>
            <DialogDescription>
              {editing === "new"
                ? "创建独立工作文件夹，项目内新会话共享文件。"
                : "仅修改展示名称，不改变文件夹位置或已有会话。"}
            </DialogDescription>
          </DialogHeader>
          <form
            key={editing === "new" ? "new" : editing?.id}
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (editing)
                saveProject.mutate({
                  project: editing,
                  name: String(
                    new FormData(event.currentTarget).get("name"),
                  ).trim(),
                });
            }}
          >
            <Field>
              <FieldLabel htmlFor="project-name">项目名称</FieldLabel>
              <Input
                id="project-name"
                name="name"
                required
                maxLength={80}
                defaultValue={editing && editing !== "new" ? editing.name : ""}
              />
            </Field>
            {saveProject.error && (
              <p role="alert">{saveProject.error.message}</p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(null)}
              >
                取消
              </Button>
              <Button type="submit" disabled={saveProject.isPending}>
                {editing === "new" ? "创建项目" : "保存名称"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名对话</DialogTitle>
            <DialogDescription>名称由 DSH 保存。</DialogDescription>
          </DialogHeader>
          <form
            key={renaming?.id}
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (renaming)
                update.mutate({
                  conversation: renaming,
                  change: {
                    title: String(
                      new FormData(event.currentTarget).get("title"),
                    ).trim(),
                  },
                });
            }}
          >
            <Field>
              <FieldLabel htmlFor="conversation-title">对话名称</FieldLabel>
              <Input
                id="conversation-title"
                name="title"
                required
                maxLength={120}
                defaultValue={renaming?.title}
              />
            </Field>
            {update.error && <p role="alert">{update.error.message}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenaming(null)}
              >
                取消
              </Button>
              <Button type="submit" disabled={update.isPending}>
                保存名称
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {(removeProject.error || fork.error) && (
        <p role="alert">
          {removeProject.error?.message || fork.error?.message}
        </p>
      )}
    </div>
  );
}
