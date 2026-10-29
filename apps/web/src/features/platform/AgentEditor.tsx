import { SkillVersionPreview } from "@/features/skills/SkillVersionPreview";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { ResourcePicker } from "./ResourcePicker";
import { useSkills } from "@/features/skills/catalog";
import { useQuery } from "@tanstack/react-query";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { platformRequest } from "@/lib/platform";
import { useCatalogAction, type Agent, type ContextItem } from "./catalog";
export function AgentEditor({
  agent,
  onClose,
  backLabel = "返回智能体库",
}: {
  agent: Agent;
  onClose: () => void;
  backLabel?: string;
}) {
  const skills = useSkills();
  const [tab, setTab] = useState("basic");
  const [preview, setPreview] = useState<{
    id: string;
    revision: string;
  } | null>(null);
  const [bindings, setBindings] = useState(agent.draft.skills ?? []);
  const [knowledgeIds, setKnowledgeIds] = useState(
    agent.draft.knowledge_ids ?? [],
  );
  const { action, busy, error } = useCatalogAction();
  const knowledge = useQuery({
    queryKey: ["knowledge", agent.id],
    queryFn: ({ signal }) =>
      platformRequest<ContextItem[]>(
        `/agents/${agent.id}/knowledge`,
        "GET",
        undefined,
        signal,
      ),
  });
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-5">
      <Button variant="ghost" className="self-start" onClick={onClose}>
        {backLabel}
      </Button>
      <div>
        <h2 className="text-xl font-medium">
          编辑 {agent.name} · {agent.id.slice(0, 8)}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          修改草稿不会改变已发布版本。保存后可试运行，再发布新版本。
        </p>
      </div>
      {knowledge.error && (
        <p role="alert">
          {knowledge.error.message}{" "}
          <Button variant="outline" onClick={() => void knowledge.refetch()}>
            重新读取知识
          </Button>
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          if (agent && knowledge.data)
            void action(async () => {
              await platformRequest(`/agents/${agent.id}`, "PUT", {
                ...agent.draft,
                name: String(data.get("name")),
                description: String(data.get("description")),
                instructions: String(data.get("instructions")),
                tools: ["collaboration", "execution", "web"].filter(
                  (name) => data.get(name) === "yes",
                ),
                skills: bindings,
                knowledge_ids: knowledgeIds,
              });
              onClose();
            });
        }}
      >
        <Tabs value={tab} onValueChange={setTab} className="mb-5">
          <TabsList>
            <TabsTrigger value="basic">基本信息</TabsTrigger>
            <TabsTrigger value="rules">行为规则</TabsTrigger>
            <TabsTrigger value="resources">能力与资源</TabsTrigger>
          </TabsList>
        </Tabs>
        <FieldGroup>
          <div hidden={tab !== "basic"}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="agent-name">名称</FieldLabel>
                <Input
                  id="agent-name"
                  name="name"
                  onInvalid={() => setTab("basic")}
                  required
                  defaultValue={agent.draft.name}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="agent-description">职责</FieldLabel>
                <Input
                  id="agent-description"
                  name="description"
                  defaultValue={agent.draft.description}
                />
              </Field>
            </FieldGroup>
          </div>
          <div hidden={tab !== "rules"}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="agent-instructions">行为规则</FieldLabel>
                <Textarea
                  className="h-80 field-sizing-fixed overflow-y-auto"
                  id="agent-instructions"
                  name="instructions"
                  onInvalid={() => setTab("rules")}
                  required
                  defaultValue={agent.draft.instructions}
                />
              </Field>
            </FieldGroup>
          </div>
          <div hidden={tab !== "resources"}>
            <FieldGroup>
              {(
                [
                  ["collaboration", "自动协作"],
                  ["execution", "代码执行与文件"],
                  ["web", "网页阅读"],
                ] as const
              ).map(([name, label]) => (
                <Field key={name}>
                  <FieldLabel htmlFor={`capability-${name}`}>
                    {label}
                  </FieldLabel>
                  <NativeSelect
                    id={`capability-${name}`}
                    name={name}
                    defaultValue={
                      agent.draft.tools?.includes(name) ? "yes" : "no"
                    }
                  >
                    <NativeSelectOption value="yes">启用</NativeSelectOption>
                    <NativeSelectOption value="no">停用</NativeSelectOption>
                  </NativeSelect>
                </Field>
              ))}
              <ResourcePicker
                title="知识"
                items={(knowledge.data ?? []).map((k) => ({
                  id: k.id,
                  name: k.title || "未命名知识",
                }))}
                selected={knowledgeIds}
                disabled={busy || !knowledge.data}
                onAdd={(id) => setKnowledgeIds([...knowledgeIds, id])}
                onRemove={(id) =>
                  setKnowledgeIds(knowledgeIds.filter((k) => k !== id))
                }
              />
              {skills.error && (
                <p role="alert">
                  {skills.error.message}
                  <Button type="button" onClick={() => void skills.refetch()}>
                    重新读取 Skills
                  </Button>
                </p>
              )}
              <ResourcePicker
                title="Skill"
                items={(skills.data ?? []).map((s) => ({
                  ...s,
                  disabled: !s.enabled,
                }))}
                selected={bindings.map((b) => b.id)}
                disabled={busy || !skills.data}
                onAdd={(id) => {
                  const skill = skills.data?.find((s) => s.id === id);
                  if (skill)
                    setBindings([
                      ...bindings,
                      { id, revision: skill.revision },
                    ]);
                }}
                onRemove={(id) =>
                  setBindings(bindings.filter((b) => b.id !== id))
                }
                extra={(id) => {
                  const skill = skills.data?.find((s) => s.id === id);
                  const bound = bindings.find((b) => b.id === id);
                  return (
                    <>
                      <Button
                        type="button"
                        variant="link"
                        onClick={() => bound && setPreview(bound)}
                      >
                        查看内容 · {bound?.revision.slice(0, 8)}
                      </Button>
                      {skill?.enabled && bound?.revision !== skill.revision ? (
                        <Button
                          type="button"
                          variant="link"
                          disabled={busy}
                          onClick={() =>
                            setBindings(
                              bindings.map((b) =>
                                b.id === id
                                  ? { ...b, revision: skill.revision }
                                  : b,
                              ),
                            )
                          }
                        >
                          有新版 · 更新
                        </Button>
                      ) : null}
                    </>
                  );
                }}
              />
            </FieldGroup>
          </div>
          <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background py-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              {backLabel}
            </Button>
            {error && <p role="alert">{error}</p>}
            <Button
              type="submit"
              disabled={busy || !knowledge.data || !skills.data}
            >
              {busy ? "正在保存…" : "保存草稿"}
            </Button>
          </div>
        </FieldGroup>
      </form>
      {preview && (
        <SkillVersionPreview {...preview} onClose={() => setPreview(null)} />
      )}
    </section>
  );
}
