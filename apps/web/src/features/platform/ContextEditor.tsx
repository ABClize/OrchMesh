import { useState } from "react";
import { Button } from "@/components/ui/button";
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
  kind: "memory" | "knowledge";
  row?: Item;
  onSaved: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <Button
        variant={row ? "outline" : "default"}
        size="sm"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        {row ? "编辑" : `添加${kind === "memory" ? "记忆" : "知识"}`}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {row ? "编辑" : "添加"}
              {kind === "memory" ? "记忆" : "知识"}
            </DialogTitle>
            <DialogDescription>
              修改会用于之后的任务。已发布的智能体仍使用发布时的内容。
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
                await platformRequest(
                  row
                    ? `/context/${kind}/${row?.id ?? "new"}`
                    : `/context/${kind}`,
                  row ? "PUT" : "POST",
                  {
                    ...row,
                    title: String(data.get("title") || ""),
                    content: String(data.get("content")),
                  },
                );
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
                  <FieldLabel htmlFor={`edit-title-${row?.id ?? "new"}`}>
                    标题
                  </FieldLabel>
                  <Input
                    id={`edit-title-${row?.id ?? "new"}`}
                    name="title"
                    defaultValue={row?.title ?? ""}
                    required
                  />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor={`edit-content-${row?.id ?? "new"}`}>
                  内容
                </FieldLabel>
                <Textarea
                  id={`edit-content-${row?.id ?? "new"}`}
                  name="content"
                  defaultValue={row?.content ?? ""}
                  className="min-h-40"
                  maxLength={32000}
                  required
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "保存中…" : "保存"}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
