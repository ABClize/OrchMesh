import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { LoaderCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { platformRequest as request } from "@/lib/platform";
import { effortNames, type Profile, type Catalog, type Probe } from "./types";

export function ModelEditor({
  model,
  creating,
  catalog,
  onClose,
  onSaved,
}: {
  model: Profile;
  creating: boolean;
  catalog: Catalog;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState(model);
  const [secret, setSecret] = useState("");
  const [makeDefault, setMakeDefault] = useState(catalog.default === model.key);
  const [mapping, setMapping] = useState(
    model.reasoning_efforts === null
      ? ""
      : JSON.stringify(model.reasoning_efforts, null, 2),
  );
  const [result, setResult] = useState<Probe | null>(null);
  const update = (key: keyof Profile, value: string | null) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setResult(null);
    action.reset();
  };
  const action = useMutation({
    mutationFn: async (mode: "save" | "test" | "capabilities") => {
      let efforts = null;
      if (mapping.trim()) {
        try {
          efforts = JSON.parse(mapping);
        } catch {
          throw new Error("思考能力覆盖必须是有效的 JSON 对象。");
        }
      }
      const payload = {
        ...form,
        has_key: undefined,
        api_key: secret,
        reasoning_efforts: efforts,
        revision: catalog.revision,
        make_default: makeDefault,
        creating,
      };
      if (mode === "save") {
        await request("/settings/models", "PUT", payload);
        await onSaved();
      } else
        setResult(
          (await request(
            `/settings/models/probe?test=${mode === "test"}`,
            "POST",
            payload,
          )) as Probe,
        );
      return mode;
    },
  });
  const busy = action.isPending;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{creating ? "添加模型" : "编辑模型"}</DialogTitle>
          <DialogDescription>
            填写模型服务的连接信息。测试连接只发送一条测试消息，不包含你的对话。
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            action.mutate("save");
          }}
        >
          <fieldset disabled={busy}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="model-name">显示名称</FieldLabel>
                <Input
                  id="model-name"
                  required
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="例如：DeepSeek Pro"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="model-id">模型 ID</FieldLabel>
                <Input
                  id="model-id"
                  required
                  value={form.id}
                  onChange={(e) => update("id", e.target.value)}
                  placeholder="供应商提供的模型 ID"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="model-url">API 地址</FieldLabel>
                <Input
                  id="model-url"
                  type="url"
                  required
                  value={form.base_url}
                  onChange={(e) => update("base_url", e.target.value)}
                  placeholder="https://api.example.com/v1"
                />
                <FieldDescription>
                  填写 API 基础地址，不添加 /chat/completions。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="model-secret">API 密钥</FieldLabel>
                <Input
                  id="model-secret"
                  type="password"
                  autoComplete="new-password"
                  required={creating}
                  value={secret}
                  onChange={(e) => {
                    setSecret(e.target.value);
                    setResult(null);
                  }}
                  placeholder={
                    model.has_key ? "已保存，留空保持不变" : "输入密钥"
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="model-protocol">接口协议</FieldLabel>
                <NativeSelect
                  id="model-protocol"
                  value={form.api}
                  onChange={(e) => update("api", e.target.value)}
                >
                  <NativeSelectOption value="openai-completions">
                    OpenAI Chat Completions
                  </NativeSelectOption>
                  <NativeSelectOption value="openai-responses">
                    OpenAI Responses
                  </NativeSelectOption>
                  <NativeSelectOption value="anthropic-messages">
                    Anthropic Messages
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="model-provider">模型所属厂商</FieldLabel>
                <NativeSelect
                  id="model-provider"
                  value={form.provider}
                  onChange={(e) => update("provider", e.target.value)}
                >
                  {["project", "deepseek", "openai", "anthropic", "google"].map(
                    (p) => (
                      <NativeSelectOption key={p} value={p}>
                        {p === "project" ? "自定义 / 兼容接口" : p}
                      </NativeSelectOption>
                    ),
                  )}
                </NativeSelect>
                <FieldDescription>
                  用于自动识别模型支持的思考强度。实际连接地址仍使用上面填写的
                  API 地址。
                </FieldDescription>
              </Field>
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  高级设置：手动配置思考强度
                </summary>
                <FieldGroup className="mt-4">
                  <Field>
                    <FieldLabel htmlFor="model-efforts">
                      思考强度参数（JSON，可选）
                    </FieldLabel>
                    <Textarea
                      id="model-efforts"
                      value={mapping}
                      onChange={(e) => {
                        setMapping(e.target.value);
                        setResult(null);
                      }}
                      placeholder={
                        '留空自动识别；{} 关闭思考；例如 {"off":null,"high":"high"}'
                      }
                    />
                    <FieldDescription>
                      通常无需填写。仅当服务商要求的参数与自动识别结果不同时修改。
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="model-thinking">
                      思考协议兼容
                    </FieldLabel>
                    <NativeSelect
                      id="model-thinking"
                      value={form.thinking_format ?? "auto"}
                      onChange={(e) =>
                        update(
                          "thinking_format",
                          e.target.value === "auto" ? null : e.target.value,
                        )
                      }
                    >
                      <NativeSelectOption value="auto">
                        自动识别
                      </NativeSelectOption>
                      <NativeSelectOption value="deepseek">
                        DeepSeek
                      </NativeSelectOption>
                    </NativeSelect>
                  </Field>
                </FieldGroup>
              </details>
              <Field orientation="horizontal">
                <input
                  id="model-default"
                  disabled={catalog.default === model.key}
                  type="checkbox"
                  checked={makeDefault}
                  onChange={(e) => setMakeDefault(e.target.checked)}
                />
                <FieldLabel htmlFor="model-default">
                  设为新对话的默认模型
                </FieldLabel>
              </Field>
            </FieldGroup>
          </fieldset>
          {action.error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{action.error.message}</AlertDescription>
            </Alert>
          )}
          {result && (
            <Alert className="mt-4">
              <CheckCircle2 />
              <AlertDescription>
                {action.data === "test" ? "连接成功。" : "能力读取成功。"}
                思考级别：
                {result.efforts
                  .map((e) => effortNames[e.id] ?? e.name)
                  .join(" / ") || "无可选思考级别"}
              </AlertDescription>
            </Alert>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => action.mutate("test")}
            >
              {busy && <LoaderCircle className="animate-spin" />}测试连接
            </Button>
            <Button type="submit" disabled={busy}>
              保存模型
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
