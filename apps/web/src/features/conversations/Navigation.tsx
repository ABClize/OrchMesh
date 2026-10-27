import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Trash2,
  Search,
  Archive,
  ArchiveRestore,
  Pin,
  PinOff,
  MoreHorizontal,
  Pencil,
  GitBranch,
} from "lucide-react";
import type { components } from "@/lib/api-schema";
import { platformRequest } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
type Conversation = components["schemas"]["ConversationRead"];
export function Navigation({
  archived,
  setArchived,
  conversations,
  id,
  onSelect,
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
  const [renaming, setRenaming] = useState<Conversation | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const [pending, setPending] = useState(false);
  const visible = conversations
    .filter(
      (row) =>
        row.archived === archived &&
        row.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    )
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
  async function remove() {
    if (!deleting || pending) return;
    setPending(true);
    setError("");
    try {
      await platformRequest(`/conversations/${deleting.id}`, "DELETE");
      onArchive(deleting.id);
      setDeleting(null);
      await query.invalidateQueries({ queryKey: ["conversations"] });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(false);
    }
  }
  async function update(row: Conversation, change: unknown) {
    setError("");
    try {
      await platformRequest(`/conversations/${row.id}`, "PATCH", change);
      if ((change as { archived?: boolean }).archived) onArchive(row.id);
      await query.invalidateQueries({ queryKey: ["conversations"] });
      setRenaming(null);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <nav
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
      aria-label="对话列表"
    >
      <div className="conversation-search">
        <Search aria-hidden="true" />
        <Input
          aria-label="搜索对话"
          placeholder="搜索对话…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <Button
        variant="ghost"
        className="justify-start"
        onClick={() => {
          setArchived(!archived);
          setError("");
        }}
      >
        <Archive />
        {archived ? "返回对话" : "已归档"}
      </Button>
      {error && <p role="alert">{error}</p>}
      <p className="sidebar-section-label">
        {archived ? "已归档" : "最近对话"} · {visible.length}
      </p>
      {!visible.length && (
        <p className="px-3 py-6 text-sm text-muted-foreground">
          {search
            ? "没有匹配的对话"
            : archived
              ? "暂无归档对话"
              : "开始一段新对话"}
        </p>
      )}
      {visible.map((row) => (
        <div
          key={row.id}
          data-selected={row.id === id}
          className="conversation-row flex items-center gap-1"
        >
          <Button
            variant="ghost"
            aria-current={row.id === id ? "page" : undefined}
            className="min-w-0 flex-1 justify-start truncate"
            onClick={() => onSelect(row)}
          >
            {row.pinned && <Pin />}
            {row.title}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${row.title} 的操作`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => setRenaming(row)}>
                  <Pencil />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void update(row, { pinned: !row.pinned })}
                >
                  {row.pinned ? <PinOff /> : <Pin />}
                  {row.pinned ? "取消置顶" : "置顶"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void update(row, { archived: !row.archived });
                  }}
                >
                  {row.archived ? <ArchiveRestore /> : <Archive />}
                  {row.archived ? "恢复" : "归档"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void platformRequest<Conversation>(
                      `/conversations/${row.id}/fork`,
                      "POST",
                    )
                      .then(async (value) => {
                        await query.invalidateQueries({
                          queryKey: ["conversations"],
                        });
                        onSelect(value);
                      })
                      .catch((cause) => setError(cause.message));
                  }}
                >
                  <GitBranch />
                  在新对话继续
                </DropdownMenuItem>
                {row.archived && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setError("");
                      setDeleting(row);
                    }}
                  >
                    <Trash2 />
                    删除对话…
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !pending) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除“{deleting?.title}”？</DialogTitle>
            <DialogDescription>
              删除后无法从对话列表恢复。已交付的文件、执行审计记录和已有分支会保留；这不是文件清理操作。
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setDeleting(null)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => void remove()}
            >
              {pending ? "正在删除…" : "删除对话"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!renaming}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名对话</DialogTitle>
            <DialogDescription>更改列表中的名称。</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (renaming)
                void update(renaming, {
                  title: String(new FormData(event.currentTarget).get("title")),
                });
            }}
          >
            <Field>
              <FieldLabel htmlFor="rename">名称</FieldLabel>
              <Input
                id="rename"
                name="title"
                defaultValue={renaming?.title}
                required
                maxLength={120}
              />
              <Button type="submit">保存</Button>
            </Field>
          </form>
        </DialogContent>
      </Dialog>
    </nav>
  );
}
