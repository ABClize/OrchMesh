import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
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
  async function update(row: Conversation, change: unknown) {
    try {
      await platformRequest(`/conversations/${row.id}`, "PATCH", change);
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
      <Button variant="ghost" onClick={() => setArchived(!archived)}>
        {archived ? "返回对话" : "已归档"}
      </Button>
      {error && <p role="alert">{error}</p>}
      {conversations
        .filter((row) => row.archived === archived)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned))
        .map((row) => (
          <div key={row.id} className="flex items-center gap-1">
            <Button
              variant={row.id === id ? "secondary" : "ghost"}
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
                      if (!row.archived) onArchive(row.id);
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
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
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
