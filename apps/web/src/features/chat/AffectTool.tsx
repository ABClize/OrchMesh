import { Delivery } from "../workspace/Delivery";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { Terminal, FileText, Wrench } from "lucide-react";
import { ToolCallCard } from "@/components/ui/tool-call-card-clean";
import { ToolFallback } from "@/components/assistant-ui/elements/tool-fallback.aui";

export const AffectTool: ToolCallMessagePartComponent = (props) => {
  if (props.toolName === "present_files" || props.toolName === "present")
    return <Delivery {...props} />;
  const { toolName, argsText, result, status, isError } = props;
  // Preserve the original renderer for interruption/approval states that the
  // three-state AffectUI card cannot represent faithfully.
  if (status.type === "requires-action" || status.type === "incomplete")
    return <ToolFallback {...props} />;
  const Icon =
    toolName === "bash"
      ? Terminal
      : /read|write|edit/.test(toolName)
        ? FileText
        : Wrench;
  return (
    <ToolCallCard
      name={toolName}
      icon={<Icon />}
      args={argsText}
      result={result}
      status={
        isError ? "error" : status.type === "running" ? "running" : "success"
      }
      summary={
        isError
          ? "执行失败"
          : status.type === "running"
            ? "正在执行"
            : "执行完成"
      }
      error={isError ? "工具返回错误，请查看结果。" : undefined}
    />
  );
};
