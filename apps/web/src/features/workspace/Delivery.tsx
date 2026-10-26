import { useState } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { Button } from "@/components/ui/button";
import { deliveredFiles, downloadFile, useFiles } from "./files";

export const Delivery: ToolCallMessagePartComponent = ({
  result,
  status,
  isError,
}) => {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const files = deliveredFiles(result);
  return (
    <section aria-label="交付文件" className="rounded-xl border p-4">
      <p className="font-medium">
        {isError
          ? "文件交付失败"
          : status.type === "running"
            ? "正在准备文件…"
            : "交付文件"}
      </p>
      {files.map((file) => (
        <div key={file.path} className="flex flex-wrap items-center gap-2 py-2">
          <Button
            variant="link"
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
            variant="outline"
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
        预览和下载工作区中的当前文件。工作区外文件不提供下载。
      </p>
      {(error || (isError && !files.length)) && (
        <p role="alert">
          {error || "文件未交付，请让助手检查路径与文件大小。"}
        </p>
      )}
    </section>
  );
};
