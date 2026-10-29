import { AdminAgentEditor } from "@/features/admin/AdminAgentEditor";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/useAuth";
import { platformRequest } from "@/lib/platform";
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
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { BookOpen, ArrowLeft, RefreshCw } from "lucide-react";
import { decode, useSkills, type Detail } from "./catalog";
export { useSkills } from "./catalog";
export function SkillLibrary() {
  const { me } = useAuth();
  const admin = !!me.data?.is_superuser;
  const query = useQueryClient();
  const list = useSkills();
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const detail = useQuery({
    queryKey: ["skill", selected],
    enabled: !!selected,
    queryFn: ({ signal }) =>
      platformRequest<Detail>(`/skills/${selected}`, "GET", undefined, signal),
  });
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await work();
      await query.invalidateQueries({ queryKey: ["skills"] });
      await query.invalidateQueries({ queryKey: ["skill"] });
      setSuccess("已保存。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (editing)
    return (
      <section className="h-full overflow-y-auto p-6">
        <AdminAgentEditor
          id={editing}
          onClose={() => {
            setEditing(null);
            void detail.refetch();
          }}
          backLabel="返回 Skill"
        />
      </section>
    );
  return (
    <section className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-medium">Skill 库</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              为智能体添加可复用的操作指南。
            </p>
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void list.refetch()}
          >
            <RefreshCw />
            刷新
          </Button>
        </header>
        {(error || list.error || detail.error) && (
          <Alert variant="destructive">
            <AlertDescription>
              {error || list.error?.message || detail.error?.message}
            </AlertDescription>
          </Alert>
        )}
        {success && (
          <p role="status" className="text-sm text-muted-foreground">
            {success}
          </p>
        )}
        {selected ? (
          <>
            <Button
              variant="ghost"
              className="self-start"
              onClick={() => {
                setSelected(null);
                setError("");
              }}
            >
              <ArrowLeft />
              返回 Skill 库
            </Button>
            {detail.isPending ? (
              <p role="status">正在读取…</p>
            ) : (
              detail.data && (
                <SkillDetail
                  key={detail.data.revision + detail.data.id}
                  item={detail.data}
                  admin={admin}
                  busy={busy}
                  action={action}
                  onEditAgent={setEditing}
                />
              )
            )}
          </>
        ) : (
          <>
            {admin && (
              <details open={!list.data?.length || undefined}>
                <summary className="cursor-pointer text-sm font-medium">
                  导入 Skill
                </summary>
                <Card className="mt-3">
                  <CardHeader>
                    <CardTitle>添加 Skill</CardTitle>
                    <CardDescription>
                      从代码仓库导入，或上传已有的 Skill 文件。支持 SKILL.md 和
                      ZIP，最大 10 MiB。
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void action(() =>
                          platformRequest("/skills/import", "POST", {
                            source: f.get("source"),
                            name: f.get("name"),
                          }),
                        );
                      }}
                    >
                      <FieldGroup>
                        <div className="grid grid-cols-[2fr_1fr_auto] items-end gap-3">
                          <Field>
                            <FieldLabel htmlFor="skill-source">
                              仓库地址
                            </FieldLabel>
                            <Input
                              id="skill-source"
                              name="source"
                              placeholder="owner/repository"
                              required
                              disabled={busy}
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor="skill-name">
                              Skill 名称
                            </FieldLabel>
                            <Input
                              id="skill-name"
                              name="name"
                              required
                              disabled={busy}
                            />
                          </Field>
                          <Button disabled={busy}>
                            {busy ? "正在处理…" : "在线导入"}
                          </Button>
                        </div>
                        <Field>
                          <FieldLabel htmlFor="skill-upload">
                            上传 Skill 包
                          </FieldLabel>
                          <Input
                            id="skill-upload"
                            type="file"
                            accept=".zip,.md"
                            disabled={busy}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const f = new FormData();
                                f.append("file", file);
                                void action(() =>
                                  platformRequest("/skills/upload", "POST", f),
                                );
                              }
                              e.target.value = "";
                            }}
                          />
                        </Field>
                      </FieldGroup>
                    </form>
                  </CardContent>
                </Card>
              </details>
            )}
            {list.isPending ? (
              <p role="status">正在加载 Skill 库…</p>
            ) : !list.data?.length ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-12">
                  <BookOpen />
                  <p>还没有可用 Skill</p>
                  <p className="text-sm text-muted-foreground">
                    {admin
                      ? "先导入一份操作指南，再到智能体编辑页添加。"
                      : "请管理员导入业务 Skill。"}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {list.data.map((s) => (
                  <Card key={s.id}>
                    <CardHeader>
                      <CardTitle>
                        {s.name} {!s.enabled && "· 已停用"}
                      </CardTitle>
                      <CardDescription>{s.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between gap-3">
                      <span className="truncate text-xs text-muted-foreground">
                        {s.source === "upload" ? "本地上传" : s.source}
                      </span>
                      <Button
                        variant="outline"
                        onClick={() => setSelected(s.id)}
                      >
                        {admin ? "编辑" : "查看"}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
function SkillDetail({
  item,
  onEditAgent,
  admin,
  busy,
  action,
}: {
  item: Detail;
  onEditAgent: (id: string) => void;
  admin: boolean;
  busy: boolean;
  action: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [path, setPath] = useState("SKILL.md");
  const [content, setContent] = useState(decode(item.files["SKILL.md"]) ?? "");
  const text = decode(item.files[path] ?? "");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{item.name}</CardTitle>
        <CardDescription>{item.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">
          {item.enabled
            ? "已启用 · 可以添加到智能体"
            : "已停用 · 不能添加到智能体"}
        </p>
        <p className="text-sm">
          使用此 Skill 的草稿：{!item.used_by.length && "还没有"}
          {item.used_by.map((agent) => (
            <Button
              key={agent.id}
              variant="link"
              onClick={() => onEditAgent(agent.id)}
            >
              {agent.name} · {agent.id.slice(0, 8)}
            </Button>
          ))}
        </p>
        {!admin && (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {item.definition.content}
          </div>
        )}
        <details open={admin || undefined}>
          <summary className="cursor-pointer text-sm">
            {admin ? "编辑内容" : "查看文件"}
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="skill-file">选择文件</FieldLabel>
                <NativeSelect
                  id="skill-file"
                  value={path}
                  disabled={busy || content !== (text ?? "")}
                  onChange={(e) => {
                    setPath(e.target.value);
                    setContent(decode(item.files[e.target.value]) ?? "");
                  }}
                >
                  {Object.keys(item.files).map((p) => (
                    <NativeSelectOption key={p}>{p}</NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="skill-content">文件内容</FieldLabel>
                {text === null ? (
                  <p>
                    这个文件不能在线编辑。需要修改时，请上传包含它的完整 Skill
                    文件包。
                  </p>
                ) : (
                  <Textarea
                    id="skill-content"
                    className="min-h-80 font-mono text-xs"
                    value={content}
                    readOnly={!admin}
                    disabled={busy}
                    onChange={(e) => setContent(e.target.value)}
                  />
                )}
              </Field>
            </FieldGroup>
            {admin && (
              <>
                <div className="flex gap-3">
                  <Button
                    disabled={busy || text === null || text === content}
                    onClick={() =>
                      void action(() =>
                        platformRequest(`/skills/${item.id}/file`, "PUT", {
                          path,
                          content,
                          revision: item.revision,
                        }),
                      )
                    }
                  >
                    保存修改
                  </Button>
                  {content !== (text ?? "") && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setContent(text ?? "")}
                    >
                      取消修改
                    </Button>
                  )}
                  {item.source !== "upload" && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void action(() =>
                          platformRequest("/skills/import", "POST", {
                            source: item.source,
                            name: item.name,
                            replace_id: item.id,
                            revision: item.revision,
                          }),
                        )
                      }
                    >
                      从原仓库更新
                    </Button>
                  )}
                </div>
                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    上传文件替换
                  </summary>
                  <Field className="mt-3">
                    <FieldLabel htmlFor="replace-skill">
                      上传新版 Skill 文件包
                    </FieldLabel>
                    <Input
                      id="replace-skill"
                      type="file"
                      accept=".zip,.md"
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const f = new FormData();
                          f.append("file", file);
                          void action(() =>
                            platformRequest(
                              `/skills/upload?replace_id=${item.id}&revision=${item.revision}`,
                              "POST",
                              f,
                            ),
                          );
                        }
                        e.target.value = "";
                      }}
                    />
                  </Field>
                </details>
              </>
            )}
          </div>
        </details>
        {admin && (
          <details className="border-t pt-4">
            <summary className="cursor-pointer text-sm">启用与停用</summary>
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                停用后，不能再给智能体添加此
                Skill。已有草稿需移除它后才能保存或试运行；已发布的智能体和已开始的任务不受影响。可以随时重新启用。
              </p>
              <div>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      platformRequest(`/skills/${item.id}/state`, "PUT", {
                        enabled: !item.enabled,
                        revision: item.revision,
                      }),
                    )
                  }
                >
                  {item.enabled ? "停用此 Skill" : "重新启用"}
                </Button>
              </div>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
