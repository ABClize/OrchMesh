import { useState } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { Button } from "@/components/ui/button-clean";
import { deliveredFiles, downloadFile, useFiles } from "./files";

export const Delivery: ToolCallMessagePartComponent = ({
  result,
  status,
  isError,
}) => (
  <DeliveryFiles
    files={deliveredFiles(result)}
    running={status.type === "running"}
    isError={isError}
  />
);

export function DeliveryFiles({
  files,
  running = false,
  isError = false,
  title = "交付文件",
}: {
  files: ReturnType<typeof deliveredFiles>;
  running?: boolean;
  isError?: boolean;
  title?: string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section aria-label={title} className="rounded-xl border p-4">
      <p className="font-medium">
        {isError ? "文件交付失败" : running ? "正在准备文件…" : title}
      </p>
      {files.map((file) => (
        <div key={file.path} className="flex flex-wrap items-center gap-2 py-2">
          <Button
            variant="ghost"
            className="min-w-0 max-w-full truncate"
            onClick={() => useFiles.getState().show(file.path)}
          >
            {file.name}
          </Button>
          {file.size !== undefined && (
            <span className="text-xs text-muted-foreground">
              {Math.ceil(file.size / 1024)} KB
            </span>
          )}
          {file.description && (
            <span className="text-xs text-muted-foreground">
              {file.description}
            </span>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await downloadFile(file.path);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            下载
          </Button>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        已交付的文件可预览或下载。
      </p>
      {(error || (isError && !files.length)) && (
        <p role="alert">
          {error || "文件未交付，请让助手检查路径与文件大小。"}
        </p>
      )}
    </section>
  );
}
