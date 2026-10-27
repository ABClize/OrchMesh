import { useState } from "react";
import { Search, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ContextEditor } from "./ContextEditor";
import { platformRequest } from "@/lib/platform";
import { useCatalogAction, type ContextItem } from "./catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
export function ContextLibrary() {
  const query = useQueryClient();
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<{
    kind: "memory" | "knowledge";
    row: ContextItem;
  } | null>(null);
  const { action, busy, error } = useCatalogAction();
  const memory = useQuery({
    queryKey: ["memory"],
    queryFn: ({ signal }) =>
      platformRequest<ContextItem[]>(
        "/context/memory",
        "GET",
        undefined,
        signal,
      ),
  });
  const knowledge = useQuery({
    queryKey: ["knowledge"],
    queryFn: ({ signal }) =>
      platformRequest<ContextItem[]>(
        "/context/knowledge",
        "GET",
        undefined,
        signal,
      ),
  });
  const settings = useQuery({
    queryKey: ["memory-settings"],
    queryFn: ({ signal }) =>
      platformRequest<{ enabled: boolean }>(
        "/memory-settings",
        "GET",
        undefined,
        signal,
      ),
  });
  return (
    <section className="platform-page">
      <div className="platform-page-inner flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-medium">知识与记忆</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            管理参考资料与个人偏好。
          </p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {[memory, knowledge, settings].map((request, index) =>
          request.error ? (
            <Alert key={index} variant="destructive">
              <AlertDescription>{request.error.message}</AlertDescription>
              <Button variant="outline" onClick={() => void request.refetch()}>
                重新读取
              </Button>
            </Alert>
          ) : null,
        )}
        {(memory.isLoading || knowledge.isLoading) && (
          <p role="status">正在读取资料…</p>
        )}
        <Tabs defaultValue="knowledge">
          <div className="agent-library-toolbar">
            <TabsList aria-label="资料类型">
              <TabsTrigger value="knowledge">知识</TabsTrigger>
              <TabsTrigger value="memory">记忆</TabsTrigger>
            </TabsList>
            <div className="agent-library-search">
              <Search aria-hidden="true" />
              <Input
                aria-label="搜索资料"
                placeholder="搜索标题或内容…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          {(
            [
              ["memory", memory.data],
              ["knowledge", knowledge.data],
            ] as const
          ).map(([kind, rows]) => (
            <TabsContent
              key={kind}
              value={kind}
              className="flex flex-col gap-3"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {kind === "memory"
                    ? "个人偏好与长期记忆"
                    : "可供智能体引用的参考资料"}
                </p>
                <ContextEditor
                  kind={kind}
                  onSaved={() => query.invalidateQueries({ queryKey: [kind] })}
                />
              </div>
              {kind === "memory" && (
                <label className="flex items-center justify-between gap-4 rounded-xl border p-4 text-sm">
                  <span>
                    在后续任务中使用个人记忆
                    <span className="mt-1 block text-xs text-muted-foreground">
                      关闭后保留已保存的内容，可随时重新启用。
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label="使用个人记忆"
                    checked={settings.data?.enabled ?? false}
                    disabled={busy || !settings.data}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      void action(() =>
                        platformRequest("/memory-settings", "PUT", { enabled }),
                      );
                    }}
                  />
                </label>
              )}
              {rows?.length === 0 && (
                <p className="py-6 text-sm text-muted-foreground">
                  暂无{kind === "memory" ? "记忆" : "知识"}，点击右上方添加。
                </p>
              )}
              {rows
                ?.filter((row) =>
                  `${row.title} ${row.content}`
                    .toLowerCase()
                    .includes(search.trim().toLowerCase()),
                )
                .map((row) => (
                  <Card key={row.id}>
                    <CardHeader>
                      <CardTitle>{row.title || "个人记忆"}</CardTitle>
                      <CardDescription>
                        {row.enabled ? "启用" : "已停用"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <details>
                        <summary className="cursor-pointer text-sm text-muted-foreground">
                          查看内容
                        </summary>
                        <p className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm">
                          {row.content}
                        </p>
                      </details>
                    </CardContent>
                    <CardFooter className="flex gap-2">
                      <ContextEditor
                        kind={kind}
                        row={row}
                        onSaved={() =>
                          query.invalidateQueries({ queryKey: [kind] })
                        }
                      />
                      {kind === "memory" && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void action(() =>
                              platformRequest(
                                `/context/${kind}/${row.id}`,
                                "PUT",
                                { ...row, enabled: !row.enabled },
                              ),
                            )
                          }
                        >
                          {row.enabled ? "停用" : "启用"}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto text-destructive"
                        disabled={busy}
                        onClick={() => setDeleting({ kind, row })}
                      >
                        <Trash2 data-icon="inline-start" />
                        删除
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              {kind === "knowledge" && (
                <Field>
                  <FieldLabel htmlFor="knowledge-file">
                    导入文本或 Markdown（UTF-8，最多 32000 字符）
                  </FieldLabel>
                  <Input
                    id="knowledge-file"
                    type="file"
                    accept=".txt,.md,.markdown"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const input = event.target;
                      void action(async () => {
                        if (file.size > 128000)
                          throw new Error("文本文件过大，请拆分后导入");
                        const content = await file.text();
                        if (content.length > 32000)
                          throw new Error("文本超过 32000 字符，请拆分后导入");
                        await platformRequest("/context/knowledge", "POST", {
                          title: file.name,
                          content,
                        });
                        input.value = "";
                      });
                    }}
                  />
                </Field>
              )}
              {!!rows?.length &&
                !rows.some((row) =>
                  `${row.title} ${row.content}`
                    .toLowerCase()
                    .includes(search.trim().toLowerCase()),
                ) && (
                  <p
                    role="status"
                    className="py-6 text-sm text-muted-foreground"
                  >
                    没有匹配的资料，请换个关键词。
                  </p>
                )}
            </TabsContent>
          ))}
        </Tabs>
        <Dialog
          open={!!deleting}
          onOpenChange={(open) => {
            if (!open && !busy) setDeleting(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                删除{deleting?.kind === "memory" ? "记忆" : "知识"}
              </DialogTitle>
              <DialogDescription>
                将永久删除“{deleting?.row.title || "个人记忆"}
                ”，此操作无法撤销。
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setDeleting(null)}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={async () => {
                  if (
                    deleting &&
                    (await action(() =>
                      platformRequest(
                        `/context/${deleting.kind}/${deleting.row.id}`,
                        "DELETE",
                      ),
                    ))
                  )
                    setDeleting(null);
                }}
              >
                {busy ? "删除中…" : "确认删除"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}
