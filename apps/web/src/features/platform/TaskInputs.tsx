import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Paperclip, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { platformRequest } from "@/lib/platform";

export function TaskInputs({
  id,
  disabled,
}: {
  id: string;
  disabled: boolean;
}) {
  const query = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const files = useQuery({
    queryKey: ["inputs", id],
    queryFn: ({ signal }) =>
      platformRequest<{ id: string; name: string }[]>(
        `/conversations/${id}/inputs`,
        "GET",
        undefined,
        signal,
      ),
  });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="composer-add-trigger"
          aria-label="添加材料"
          disabled={disabled || busy}
        >
          <Plus />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72">
        <section aria-label="任务材料" className="flex flex-col gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
          >
            <Paperclip />
            {busy ? "正在上传…" : "添加材料"}
          </Button>
          <input
            ref={inputRef}
            hidden
            aria-label="上传任务材料，每个文件最多 20 MiB"
            id={`inputs-${id}`}
            type="file"
            disabled={disabled || busy}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 20 * 1024 * 1024) {
                setError("文件超过 20 MiB，请缩小后上传。");
                event.target.value = "";
                return;
              }
              const input = event.target;
              setBusy(true);
              setError("");
              try {
                const data = new FormData();
                data.append("file", file);
                await platformRequest(
                  `/conversations/${id}/inputs`,
                  "POST",
                  data,
                );
                await query.invalidateQueries({ queryKey: ["inputs", id] });
                input.value = "";
              } catch (cause) {
                setError((cause as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
          {files.data?.length ? (
            <p className="text-sm text-muted-foreground">
              已上传：{files.data.map((file) => file.name).join("、")}
            </p>
          ) : null}
          {(error || files.error) && (
            <Alert variant="destructive">
              <AlertDescription>
                {error || files.error?.message}
              </AlertDescription>
              {files.error && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void files.refetch()}
                >
                  重新读取材料
                </Button>
              )}
            </Alert>
          )}
        </section>
      </PopoverContent>
    </Popover>
  );
}
