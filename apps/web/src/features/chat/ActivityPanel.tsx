import { DeliveryFiles } from "../workspace/Delivery";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { platformRequest } from "@/lib/platform";
import { Button } from "@/components/ui/button-clean";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
type Question = {
  callId: string;
  questions: { id: string; question: string; options?: { label: string }[] }[];
};
type Task = {
  id: string;
  parent_id: string | null;
  prompt: string;
  status: string;
  questions: Question[];
  artifacts?: { name: string; path: string; size: number }[];
};
export function ActivityPanel({
  id,
  running,
  enabled,
}: {
  id: string;
  running: boolean;
  enabled: boolean;
}) {
  const query = useQueryClient();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const tasks = useQuery({
    queryKey: ["tasks", id],
    enabled,
    refetchInterval: running ? 1000 : false,
    queryFn: () => platformRequest<Task[]>(`/conversations/${id}/tasks`),
  });
  return (
    <section
      aria-label="任务和提问"
      className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4"
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {tasks.data?.map((task) => (
        <div key={task.id}>
          {task.parent_id && (
            <p className="text-sm text-muted-foreground">
              协作者 · {task.prompt} · {task.status}
            </p>
          )}
          {task.parent_id && !!task.artifacts?.length && (
            <DeliveryFiles files={task.artifacts} />
          )}
          {task.questions.map((question) => (
            <form
              key={question.callId}
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                setPending(true);
                setError("");
                try {
                  await platformRequest(`/tasks/${task.id}/answers`, "POST", {
                    call_id: question.callId,
                    answer: {
                      answers: question.questions.map((q) => ({
                        id: q.id,
                        selected: [],
                        custom: String(form.get(q.id)),
                      })),
                    },
                  });
                  await query.invalidateQueries({ queryKey: ["tasks", id] });
                } catch (cause) {
                  setError((cause as Error).message);
                } finally {
                  setPending(false);
                }
              }}
            >
              <FieldGroup>
                {question.questions.map((q) => (
                  <Field key={q.id}>
                    <FieldLabel htmlFor={`${task.id}-${q.id}`}>
                      {q.question}
                    </FieldLabel>
                    {q.options && (
                      <p className="text-xs text-muted-foreground">
                        建议：
                        {q.options.map((option) => option.label).join(" / ")}
                      </p>
                    )}
                    <Input
                      id={`${task.id}-${q.id}`}
                      name={q.id}
                      required
                      disabled={pending}
                    />
                  </Field>
                ))}
                <Button type="submit" disabled={pending}>
                  提交回答
                </Button>
              </FieldGroup>
            </form>
          ))}
        </div>
      ))}
    </section>
  );
}
