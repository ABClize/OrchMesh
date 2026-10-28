import { useState } from "react";
import { ResourcePicker } from "./ResourcePicker";
import { useSkills } from "@/features/skills/SkillLibrary";
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
}: {
  agent: Agent;
  onClose: () => void;
}) {
  const skills = useSkills();
  const [bindings, setBindings] = useState(agent.draft.skills ?? []);
  const [knowledgeIds, setKnowledgeIds] = useState(
    agent.draft.knowledge_ids ?? [],
  );
  const { action, busy, error } = useCatalogAction();
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
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-5">
      <Button variant="ghost" className="self-start" onClick={onClose}>
        返回智能体库
      </Button>
      <div>
        <h2 className="text-xl font-medium">编辑 {agent.name}</h2>
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
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="agent-name">名称</FieldLabel>
            <Input
              id="agent-name"
              name="name"
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
          <Field>
            <FieldLabel htmlFor="agent-instructions">行为规则</FieldLabel>
            <Textarea
              id="agent-instructions"
              name="instructions"
              required
              defaultValue={agent.draft.instructions}
            />
          </Field>
          {(
            [
              ["collaboration", "自动协作"],
              ["execution", "代码执行与文件"],
              ["web", "网页阅读"],
            ] as const
          ).map(([name, label]) => (
            <Field key={name}>
              <FieldLabel htmlFor={`capability-${name}`}>{label}</FieldLabel>
              <NativeSelect
                id={`capability-${name}`}
                name={name}
                defaultValue={agent.draft.tools?.includes(name) ? "yes" : "no"}
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
                setBindings([...bindings, { id, revision: skill.revision }]);
            }}
            onRemove={(id) => setBindings(bindings.filter((b) => b.id !== id))}
            extra={(id) => {
              const skill = skills.data?.find((s) => s.id === id);
              const bound = bindings.find((b) => b.id === id);
              return skill?.enabled && bound?.revision !== skill.revision ? (
                <Button
                  type="button"
                  variant="link"
                  disabled={busy}
                  onClick={() =>
                    setBindings(
                      bindings.map((b) =>
                        b.id === id ? { ...b, revision: skill.revision } : b,
                      ),
                    )
                  }
                >
                  有新版 · 更新
                </Button>
              ) : null;
            }}
          />
          {error && <p role="alert">{error}</p>}
          <Button
            type="submit"
            disabled={busy || !knowledge.data || !skills.data}
          >
            保存草稿
          </Button>
        </FieldGroup>
      </form>
    </section>
  );
}
