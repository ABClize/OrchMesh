import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, Plus, Pencil, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { platformRequest as request } from "@/lib/platform";
import { ModelEditor } from "./ModelEditor";
import { effortNames, type Profile, type Catalog } from "./types";

function describeEfforts(profile: Profile) {
  const levels = profile.supported_efforts.length
    ? profile.supported_efforts
    : Object.keys(profile.reasoning_efforts ?? {});
  return levels.length
    ? levels.map((level) => effortNames[level] ?? level).join(" / ")
    : "自动识别思考强度";
}
export function ModelSettings() {
  const query = useQueryClient();
  const [editing, setEditing] = useState<Profile | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const catalog = useQuery({
    queryKey: ["model-settings"],
    queryFn: async () => (await request("/settings/models")) as Catalog,
  });
  const fresh = () => ({
    key: crypto.randomUUID(),
    name: "",
    id: "",
    base_url: "",
    api: "openai-completions",
    provider: "project",
    thinking_format: null,
    reasoning_efforts: null,
    supported_efforts: [],
  });
  return (
    <section className="platform-page">
      <div className="platform-page-inner flex max-w-4xl flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">模型设置</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              管理工作空间模型，保存后立即用于输入框选择。
            </p>
          </div>
          <Button
            disabled={!catalog.data}
            onClick={() => {
              setCreating(true);
              setEditing(fresh());
              setNotice("");
            }}
          >
            <Plus data-icon="inline-start" />
            添加模型
          </Button>
        </div>
        {notice && (
          <Alert>
            <CheckCircle2 />
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {catalog.isPending && <Skeleton className="h-40 w-full" />}
        {catalog.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {catalog.error.message}
              <Button variant="ghost" onClick={() => void catalog.refetch()}>
                重试
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {catalog.data?.models.length === 0 && (
          <p className="text-sm text-muted-foreground">
            尚未配置模型，添加后即可开始对话。
          </p>
        )}
        {catalog.data?.models.map((model) => (
          <Card key={model.key} className="model-settings-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="size-4" />
                {model.name}
                {catalog.data.default === model.key && (
                  <span className="text-xs font-normal text-muted-foreground">
                    默认
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mt-2 text-sm">思考：{describeEfforts(model)}</p>
            </CardContent>
            <CardFooter className="justify-between">
              <span className="text-xs text-muted-foreground">
                {model.has_key ? "已配置 · 可测试连接" : "待配置密钥"}
              </span>
              <Button
                variant="outline"
                onClick={() => {
                  setCreating(false);
                  setEditing(model);
                  setNotice("");
                }}
                aria-label={`编辑 ${model.name}`}
              >
                <Pencil data-icon="inline-start" />
                编辑
              </Button>
            </CardFooter>
          </Card>
        ))}
        {editing && catalog.data && (
          <ModelEditor
            key={editing.key}
            model={editing}
            creating={creating}
            catalog={catalog.data}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              await Promise.all([
                query.invalidateQueries({ queryKey: ["model-settings"] }),
                query.invalidateQueries({ queryKey: ["model"] }),
              ]);
              setEditing(null);
              setNotice("模型已保存，输入框模型列表已更新。");
            }}
          />
        )}
      </div>
    </section>
  );
}
