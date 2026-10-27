import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { platformRequest } from "@/lib/platform";
import { Field, FieldLabel } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function AgentComments({ agentId }: { agentId: string }) {
  const query = useQueryClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const comments = useQuery({
    queryKey: ["comments", agentId],
    queryFn: ({ signal }) =>
      platformRequest<{ id: string; text: string }[]>(
        `/agents/${agentId}/comments`,
        "GET",
        undefined,
        signal,
      ),
  });
  return (
    <div className="flex flex-col gap-2">
      {comments.isLoading && <p role="status">正在读取评论…</p>}
      {comments.error && <p role="alert">{comments.error.message}</p>}
      {comments.data?.map((row) => (
        <p key={row.id} className="text-sm">
          {row.text}
        </p>
      ))}
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          const form = event.currentTarget;
          void platformRequest(`/agents/${agentId}/comments`, "POST", {
            text: String(new FormData(form).get("text")),
          })
            .then(async () => {
              form.reset();
              await query.invalidateQueries({
                queryKey: ["comments", agentId],
              });
            })
            .catch((cause) => setError(cause.message))
            .finally(() => setBusy(false));
        }}
      >
        <Field>
          <FieldLabel htmlFor={`comment-${agentId}`}>评论</FieldLabel>
          <Input
            id={`comment-${agentId}`}
            name="text"
            required
            maxLength={4000}
          />
          <Button type="submit" disabled={busy}>
            发表
          </Button>
        </Field>
      </form>
    </div>
  );
}
