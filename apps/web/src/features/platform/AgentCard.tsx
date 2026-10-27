import {
  Bot,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Play,
  Upload,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { Agent } from "./catalog";
const toolNames: Record<string, string> = {
  collaboration: "多智能体协作",
  execution: "任务执行",
  web: "联网检索",
};
export function AgentCard({
  agent,
  mine,
  busy,
  onStart,
  onEdit,
  onPublish,
  onComments,
}: {
  agent: Agent;
  mine: boolean;
  busy: boolean;
  onStart: (draft: boolean) => void;
  onEdit: () => void;
  onPublish: () => void;
  onComments: () => void;
}) {
  const published = !!agent.published_version;
  return (
    <Card className="agent-library-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="agent-library-icon">
            <Bot aria-hidden="true" />
          </div>
          <span className="text-xs text-muted-foreground">
            {published ? "已发布" : "草稿"}
          </span>
        </div>
        <CardTitle className="min-w-0 break-words text-base leading-6">
          {agent.name}
        </CardTitle>
        <CardDescription
          className="line-clamp-2 min-h-10 break-words leading-5"
          title={agent.description}
        >
          {agent.description || "尚未添加简介"}
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <p className="truncate text-xs text-muted-foreground">
          {(agent.draft.tools ?? [])
            .map((t) => toolNames[t] ?? t)
            .join(" · ") || "专注对话"}
        </p>
      </CardContent>
      <CardFooter className="justify-between gap-2">
        {mine ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label={`${agent.name} 的管理操作`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil />
                  编辑草稿
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onStart(true)}>
                  <Play />
                  试运行草稿
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onPublish}>
                  <Upload />
                  发布新版本
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={onComments}
            aria-label={`查看 ${agent.name} 的评论`}
          >
            <MessageSquare data-icon="inline-start" />
            评论
          </Button>
        )}
        <Button
          size="sm"
          variant={published ? "secondary" : "outline"}
          disabled={busy}
          onClick={() => onStart(!published)}
        >
          {published ? "开始对话" : "试运行"}
          <ArrowUpRight data-icon="inline-end" />
        </Button>
      </CardFooter>
    </Card>
  );
}
