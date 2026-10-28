import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Save } from "lucide-react";
import { platformRequest } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import type { components } from "@/lib/api-schema";
type Catalog = components["schemas"]["PromptCatalog"];
const fields = [
  {
    key: "continuation",
    name: "任务恢复提示",
    description: "任务中断后继续执行时，提醒智能体检查已有进度、接着完成工作。",
  },
  {
    key: "assistant",
    name: "OrchMesh 主 Agent",
    description: "普通对话的默认助手：定义职责、回答风格和协作方式。",
  },
  {
    key: "builder",
    name: "Agent Builder",
    description: "创建智能体时使用：引导澄清需求并创建或修改草稿。",
  },
  {
    key: "platform",
    name: "平台公共指令",
    description:
      "应用于所有新任务，包括自建智能体和委派任务。实际权限仍由平台控制。",
  },
] as const;
function PromptForm({ catalog }: { catalog: Catalog }) {
  const query = useQueryClient();
  const [selected, setSelected] = useState<string>("assistant");
  const [values, setValues] = useState(catalog.prompts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = fields.some(({ key }) => values[key] !== catalog.prompts[key]);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        setNotice("");
        try {
          const saved = await platformRequest<Catalog>(
            "/settings/prompts",
            "PUT",
            { prompts: values, revision: catalog.revision },
          );
          query.setQueryData(["prompt-settings"], saved);
          setNotice("已保存。新任务将使用这些提示词，已发起的任务保持不变。");
        } catch (cause) {
          setError((cause as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error} 当前编辑内容已保留。</AlertDescription>
        </Alert>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      <label className="flex flex-col gap-2 text-sm">
        编辑对象
        <NativeSelect
          aria-label="编辑对象"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {fields.map((f) => (
            <NativeSelectOption key={f.key} value={f.key}>
              {f.name}
              {values[f.key] !== catalog.prompts[f.key] ? " · 未保存" : ""}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      {fields
        .filter(({ key }) => key === selected)
        .map(({ key, name, description }) => (
          <Card key={key}>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle>
                  <label htmlFor={`prompt-${key}`}>{name}</label>
                </CardTitle>
                <CardDescription id={`prompt-help-${key}`} className="mt-2">
                  {description}
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || values[key] === catalog.defaults[key]}
                aria-label={`恢复${name}默认提示词`}
                onClick={() => {
                  setValues({ ...values, [key]: catalog.defaults[key] });
                  setNotice("已填入默认提示词，点击保存后生效。");
                }}
              >
                <RotateCcw data-icon="inline-start" />
                恢复默认
              </Button>
            </CardHeader>
            <CardContent>
              <Textarea
                id={`prompt-${key}`}
                aria-describedby={`prompt-help-${key}`}
                value={values[key]}
                onChange={(e) => {
                  setValues({ ...values, [key]: e.target.value });
                  setNotice("");
                }}
                disabled={busy}
                required
                maxLength={32000}
                className="min-h-36 resize-y font-mono text-sm leading-6"
              />
              <p className="mt-2 text-right text-xs text-muted-foreground">
                {values[key].length} / 32000
              </p>
            </CardContent>
          </Card>
        ))}
      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t bg-background py-3">
        <span className="text-sm text-muted-foreground">
          {dirty ? "有未保存的修改，保存后将替换原设置" : "已保存"}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={busy || !dirty}
            onClick={() => {
              setValues(catalog.prompts);
              setError("");
              setNotice("");
            }}
          >
            撤销修改
          </Button>
          <Button
            type="submit"
            disabled={
              busy || !dirty || fields.some(({ key }) => !values[key].trim())
            }
          >
            <Save data-icon="inline-start" />
            {busy ? "保存中…" : "保存提示词"}
          </Button>
        </div>
      </div>
    </form>
  );
}
export function PromptSettings() {
  const catalog = useQuery({
    queryKey: ["prompt-settings"],
    queryFn: ({ signal }) =>
      platformRequest<Catalog>("/settings/prompts", "GET", undefined, signal),
    refetchOnWindowFocus: false,
  });
  return (
    <section className="platform-page">
      <div className="platform-page-inner flex flex-col gap-5">
        <header>
          <h1 className="text-xl font-medium">提示词设置</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            设置智能体的工作方式和回答要求。
          </p>
        </header>
        {catalog.isPending && <Skeleton className="h-60" />}
        {catalog.error && (
          <Alert variant="destructive">
            <AlertDescription>{catalog.error.message}</AlertDescription>
            <Button variant="outline" onClick={() => void catalog.refetch()}>
              重新读取
            </Button>
          </Alert>
        )}
        {catalog.data && <PromptForm catalog={catalog.data} />}
      </div>
    </section>
  );
}
