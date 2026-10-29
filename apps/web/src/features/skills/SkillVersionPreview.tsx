import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { platformRequest } from "@/lib/platform";
import { decode, type Detail } from "./catalog";

export function SkillVersionPreview({
  id,
  revision,
  onClose,
}: {
  id: string;
  revision: string;
  onClose: () => void;
}) {
  const [path, setPath] = useState("SKILL.md");
  const query = useQuery({
    queryKey: ["skill-preview", id, revision],
    queryFn: async ({ signal }) => {
      const bound = await platformRequest<Detail>(
        `/skills/${id}?revision=${encodeURIComponent(revision)}`,
        "GET",
        undefined,
        signal,
      );
      const latest = await platformRequest<Detail>(
        `/skills/${id}`,
        "GET",
        undefined,
        signal,
      );
      return { bound, latest };
    },
  });
  const files = [
    ...new Set([
      ...Object.keys(query.data?.bound.files ?? {}),
      ...Object.keys(query.data?.latest.files ?? {}),
    ]),
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Skill 内容对照</DialogTitle>
          <DialogDescription>
            左侧是草稿选择的版本，右侧是库中最新版。此处只查看，不会更新草稿。
          </DialogDescription>
        </DialogHeader>
        {query.isPending && <p role="status">正在读取…</p>}
        {query.error && (
          <div role="alert">
            {query.error.message}
            <Button onClick={() => void query.refetch()}>重试</Button>
          </div>
        )}
        {query.data && (
          <>
            <NativeSelect
              aria-label="对照文件"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            >
              {files.map((file) => (
                <NativeSelectOption key={file} value={file}>
                  {file}
                  {query.data.bound.files[file] ===
                  query.data.latest.files[file]
                    ? " · 无变化"
                    : " · 已变化"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <div className="grid grid-cols-2 gap-4">
              {(
                [
                  ["草稿选择", query.data.bound],
                  ["库中最新", query.data.latest],
                ] as const
              ).map(([label, item]) => (
                <section key={label} className="min-w-0">
                  <h3 className="mb-2 text-sm">
                    {label} · {item.revision.slice(0, 8)}
                  </h3>
                  <pre className="h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg border p-3 text-xs">
                    {item.files[path] === undefined
                      ? "此版本没有该文件"
                      : (decode(item.files[path]) ?? "二进制文件，无法预览")}
                  </pre>
                </section>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
