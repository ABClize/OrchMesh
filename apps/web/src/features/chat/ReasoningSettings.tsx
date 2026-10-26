import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

type ModelInfo = {
  model: string;
  efforts: { id: string; name: string }[];
  defaultEffort: string | null;
};
const labels: Record<string, string> = {
  default: "模型默认",
  off: "关闭思考",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
};
export function ReasoningSettings({
  id,
  value,
  running,
}: {
  id: string;
  value: string;
  running: boolean;
}) {
  const [open, setOpen] = useState(false);
  const query = useQueryClient();
  const info = useQuery({
    queryKey: ["model"],
    enabled: open,
    staleTime: 60000,
    refetchOnWindowFocus: false,
    retry: 2,
    retryDelay: 1500,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/model");
      if (error || !data) throw new Error("模型能力暂不可用，请稍后重试。");
      return data as ModelInfo;
    },
  });
  const change = useMutation({
    mutationFn: async (reasoning: string) => {
      const { error } = await api.PUT(
        "/api/conversations/{conversation_id}/reasoning",
        { params: { path: { conversation_id: id } }, body: { reasoning } },
      );
      if (error)
        throw new Error("设置失败，可能有任务正在运行或此等级已不可用。");
    },
    onSuccess: () => query.invalidateQueries({ queryKey: ["conversations"] }),
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" disabled={running}>
          思考：{labels[value] ?? value}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="end">
        <Label htmlFor="reasoning-effort">此对话的模型思考</Label>
        <p className="text-xs text-muted-foreground">
          从下一次发送生效；这会改变模型请求，不是隐藏推理文本。
        </p>
        {info.data && (
          <>
            <p className="text-sm">{info.data.model}</p>
            <NativeSelect
              id="reasoning-effort"
              value={value}
              disabled={change.isPending || running}
              onChange={(e) => change.mutate(e.target.value)}
            >
              <NativeSelectOption value="default">模型默认</NativeSelectOption>
              {!["default", ...info.data.efforts.map((e) => e.id)].includes(
                value,
              ) && (
                <NativeSelectOption value={value} disabled>
                  已不可用：{value}
                </NativeSelectOption>
              )}
              {info.data.efforts.map((e) => (
                <NativeSelectOption key={e.id} value={e.id}>
                  {labels[e.id] ?? e.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {!info.data.efforts.length && (
              <p className="text-xs text-muted-foreground">
                此模型未声明可调思考能力，目前由供应商默认值决定。
              </p>
            )}
          </>
        )}
        {info.isPending && <p>正在读取模型能力…</p>}
        {(info.error || change.error) && (
          <p role="alert">{info.error?.message ?? change.error?.message}</p>
        )}
        {info.isError && (
          <Button variant="outline" onClick={() => void info.refetch()}>
            重试
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
