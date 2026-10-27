import { useState } from "react";
import { Button } from "@/components/ui/button-clean";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { platformRequest } from "@/lib/platform";

type Item = {
  id: string;
  content: string;
  title: string;
  enabled: boolean;
  agent_id: string | null;
};
export function ContextEditor({
  kind,
  row,
  onSaved,
}: {
  kind: string;
  row: Item;
  onSaved: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <Button onClick={() => setOpen(true)}>编辑</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑{kind === "memory" ? "记忆" : "知识"}</DialogTitle>
            <DialogDescription>
              修改影响后续任务，已发布智能体的知识快照保持不变。
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert">{error}</p>}
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setBusy(true);
              setError("");
              try {
                await platformRequest(`/context/${kind}/${row.id}`, "PUT", {
                  ...row,
                  title: String(data.get("title") || ""),
                  content: String(data.get("content")),
                });
                await onSaved();
                setOpen(false);
              } catch (cause) {
                setError((cause as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <FieldGroup>
              {kind === "knowledge" && (
                <Field>
                  <FieldLabel htmlFor={`edit-title-${row.id}`}>标题</FieldLabel>
                  <Input
                    id={`edit-title-${row.id}`}
                    name="title"
                    defaultValue={row.title}
                    required
                  />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor={`edit-content-${row.id}`}>内容</FieldLabel>
                <Textarea
                  id={`edit-content-${row.id}`}
                  name="content"
                  defaultValue={row.content}
                  maxLength={32000}
                  required
                />
              </Field>
              <Button type="submit" disabled={busy}>
                保存
              </Button>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
