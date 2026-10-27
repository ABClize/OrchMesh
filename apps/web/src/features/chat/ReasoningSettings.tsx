import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Brain,
  Check,
  ChevronDown,
  Cpu,
  LoaderCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";

type ModelInfo = {
  id: string;
  name: string;
  efforts: { id: string; label: string }[];
};
const labels: Record<string, string> = {
  default: "自动",
  off: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
};
const descriptions: Record<string, string> = {
  default: "使用模型默认策略",
  off: "直接回答，减少等待",
  high: "深入分析复杂任务",
};

/** Composer controls share the model capability query; only configured efforts are actionable. */
export function ReasoningSettings({
  id,
  value,
  modelId,
  onModelChange,
  running,
  onChange,
}: {
  id?: string;
  value: string;
  modelId?: string | null;
  onModelChange?: (value: string) => void;
  running: boolean;
  onChange?: (value: string) => void;
}) {
  const [modelOpen, setModelOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const query = useQueryClient();
  const info = useQuery({
    queryKey: ["model"],
    staleTime: 60000,
    refetchOnWindowFocus: true,
    refetchInterval: 30000,
    retry: 2,
    retryDelay: 1500,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/model");
      if (error || !data) throw new Error("模型能力暂不可用");
      return data as { default_model: string | null; models: ModelInfo[] };
    },
  });
  const change = useMutation({
    mutationKey: ["model-preference", id ?? "draft"],
    mutationFn: async (preference: {
      reasoning?: string;
      model_id?: string;
    }) => {
      if (!id) {
        if (preference.model_id) {
          const model = info.data?.models.find(
            (m) => m.id === preference.model_id,
          );
          onModelChange?.(preference.model_id);
          if (!model?.efforts.some((e) => e.id === value))
            onChange?.("default");
        } else if (preference.reasoning) onChange?.(preference.reasoning);
        return;
      }
      const { error } = await api.PUT(
        "/api/conversations/{conversation_id}/reasoning",
        { params: { path: { conversation_id: id } }, body: preference },
      );
      if (error) throw new Error("未能保存，请重试；原设置已保留。");
    },
    onSuccess: async () => {
      await query.invalidateQueries({ queryKey: ["conversations"] });
      setOpen(false);
      setModelOpen(false);
    },
  });
  const selected = info.data?.models.find(
    (m) => m.id === (modelId || info.data.default_model),
  );
  const efforts = [
    { id: "default", label: "自动" },
    ...(selected?.efforts ?? []).filter((e) => e.id !== "default"),
  ];
  return (
    <div className="composer-model-controls">
      <DropdownMenu
        open={modelOpen}
        onOpenChange={(next) => {
          if (!change.isPending) {
            setModelOpen(next);
            if (next) change.reset();
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="composer-model-trigger"
            aria-label="选择模型"
            disabled={running || change.isPending}
          >
            <Cpu data-icon="inline-start" />
            <span>
              {selected?.name ??
                (info.isError
                  ? "模型不可用"
                  : info.data
                    ? "请选择模型"
                    : "读取模型…")}
            </span>
            <ChevronDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={10}
          className="composer-picker w-72"
        >
          <DropdownMenuLabel>当前模型</DropdownMenuLabel>
          <DropdownMenuGroup>
            {info.data?.models.map((model) => (
              <DropdownMenuItem
                key={model.id}
                className="composer-model-option"
                disabled={change.isPending}
                onSelect={(event) => {
                  event.preventDefault();
                  change.mutate({ model_id: model.id });
                }}
              >
                <Cpu />
                <span className="flex-1">{model.name}</span>
                {selected?.id === model.id && <Check />}
              </DropdownMenuItem>
            ))}
            {info.isError && (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  void info.refetch();
                }}
              >
                重新读取模型
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <p className="picker-hint">
            {info.isError
              ? info.error.message
              : "切换应用于下一次发送；思考选项随模型变化。"}
          </p>
          {change.error && (
            <p className="picker-error" role="alert">
              {change.error.message}
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          if (!change.isPending) {
            setOpen(next);
            if (next) change.reset();
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="composer-effort-trigger"
            aria-label={`思考强度：${labels[value] ?? value}`}
            disabled={
              running ||
              change.isPending ||
              info.isPending ||
              info.isError ||
              !selected ||
              efforts.length === 1
            }
          >
            {change.isPending ? (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" />
            ) : value === "off" ? (
              <Zap />
            ) : (
              <Brain />
            )}
            <span>{labels[value] ?? value}</span>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={10}
          className="composer-picker w-60"
        >
          <DropdownMenuLabel>思考强度</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => change.mutate({ reasoning: next })}
          >
            {efforts.map((e) => (
              <DropdownMenuRadioItem
                key={e.id}
                value={e.id}
                disabled={change.isPending}
                onSelect={(event) => event.preventDefault()}
              >
                <span className="flex flex-col gap-0.5">
                  <span>{labels[e.id] ?? e.label}</span>
                  <span className="picker-option-note">
                    {descriptions[e.id] ?? "调整模型的推理投入"}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <p className="picker-hint">应用于下一次发送</p>
          {change.error && (
            <p className="picker-error" role="alert">
              {change.error.message}
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
