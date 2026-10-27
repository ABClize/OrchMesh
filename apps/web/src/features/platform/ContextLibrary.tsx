import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ContextEditor } from "./ContextEditor";
import { platformRequest } from "@/lib/platform";
import { useCatalogAction, type ContextItem } from "./catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
          <TabsList aria-label="资料类型">
            <TabsTrigger value="knowledge">知识</TabsTrigger>
            <TabsTrigger value="memory">记忆</TabsTrigger>
          </TabsList>
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
              {kind === "memory" && (
                <Button
                  disabled={busy || !settings.data}
                  onClick={() =>
                    void action(() =>
                      platformRequest("/memory-settings", "PUT", {
                        enabled: !settings.data?.enabled,
                      }),
                    )
                  }
                >
                  {settings.data?.enabled ? "停用全部记忆" : "启用记忆"}
                </Button>
              )}
              {rows?.length === 0 && (
                <p className="py-6 text-sm text-muted-foreground">
                  暂无{kind === "memory" ? "记忆" : "知识"}，可在下方添加。
                </p>
              )}
              {rows?.map((row) => (
                <Card key={row.id}>
                  <CardHeader>
                    <CardTitle>{row.title || "个人记忆"}</CardTitle>
                    <CardDescription>
                      {row.enabled ? "启用" : "已停用"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap">{row.content}</p>
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
                      disabled={busy}
                      onClick={() =>
                        void action(() =>
                          platformRequest(
                            `/context/${kind}/${row.id}`,
                            "DELETE",
                          ),
                        )
                      }
                    >
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
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const data = new FormData(form);
                  void action(async () => {
                    await platformRequest(`/context/${kind}`, "POST", {
                      title: String(data.get("title") || ""),
                      content: String(data.get("content")),
                    });
                    form.reset();
                  });
                }}
              >
                <FieldGroup>
                  {kind === "knowledge" && (
                    <Field>
                      <FieldLabel htmlFor="knowledge-title">标题</FieldLabel>
                      <Input id="knowledge-title" name="title" required />
                    </Field>
                  )}
                  <Field>
                    <FieldLabel htmlFor={`${kind}-content`}>
                      新增{kind === "memory" ? "记忆" : "知识"}
                    </FieldLabel>
                    <Textarea id={`${kind}-content`} name="content" required />
                  </Field>
                  <Button type="submit" disabled={busy}>
                    保存
                  </Button>
                </FieldGroup>
              </form>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}
