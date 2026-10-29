import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

export type Filters = {
  search: string;
  status: string;
  role: string;
  period: string;
  kind: string;
  worker: string;
  agent_id: string;
  owner_id: string;
  owner_label: string;
  agent_label: string;
};
export const emptyFilters: Filters = {
  search: "",
  status: "",
  role: "",
  period: "",
  kind: "",
  worker: "",
  agent_id: "",
  owner_id: "",
  owner_label: "",
  agent_label: "",
};
const taskStatuses = [
  ["queued", "排队中"],
  ["running", "执行中"],
  ["waiting", "等待中"],
  ["completed", "已完成"],
  ["failed", "失败"],
  ["stopped", "已停止"],
];
export function ListFilters({
  section,
  value,
  onChange,
}: {
  section: string;
  value: Filters;
  onChange: (value: Filters) => void;
}) {
  const update = (key: keyof Filters, next: string) =>
    onChange({
      ...value,
      [key]: next,
      ...(key === "owner_id" && !next ? { owner_label: "" } : {}),
      ...(key === "agent_id" && !next ? { agent_label: "" } : {}),
    });
  const select = (key: keyof Filters, label: string, options: string[][]) => (
    <NativeSelect
      aria-label={label}
      value={value[key]}
      onChange={(e) => update(key, e.target.value)}
    >
      <NativeSelectOption value="">{label}</NativeSelectOption>
      {options.map(([id, text]) => (
        <NativeSelectOption key={id} value={id}>
          {text}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input
        className="min-w-60 flex-1"
        aria-label="搜索记录"
        placeholder={
          section === "users"
            ? "搜索用户邮箱"
            : section === "agents"
              ? "搜索智能体名称或用户邮箱"
              : "搜索任务标题、目标、智能体或用户邮箱"
        }
        value={value.search}
        onChange={(e) => update("search", e.target.value)}
      />
      {select(
        "status",
        "全部状态",
        section === "users"
          ? [
              ["active", "已启用"],
              ["inactive", "已停用"],
            ]
          : section === "agents"
            ? [
                ["draft", "草稿"],
                ["published", "已发布"],
                ["archived", "已归档"],
              ]
            : taskStatuses,
      )}
      {section === "users" &&
        select("role", "全部角色", [
          ["admin", "管理员"],
          ["member", "普通用户"],
        ])}
      {section === "tasks" && (
        <>
          {select("period", "全部时间", [
            ["1", "最近 24 小时"],
            ["7", "最近 7 天"],
            ["30", "最近 30 天"],
          ])}
          {select("kind", "全部任务", [
            ["root", "主任务"],
            ["child", "子任务"],
          ])}
        </>
      )}
      {value.worker && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => update("worker", "")}
        >
          当前执行任务 ×
        </Button>
      )}
      {value.agent_id && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => update("agent_id", "")}
        >
          <span className="max-w-60 truncate" title={value.agent_label}>
            智能体：{value.agent_label || value.agent_id}
          </span>{" "}
          ×
        </Button>
      )}
      {value.owner_id && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => update("owner_id", "")}
        >
          <span className="max-w-60 truncate" title={value.owner_label}>
            用户：{value.owner_label || value.owner_id}
          </span>{" "}
          ×
        </Button>
      )}
      {Object.values(value).some(Boolean) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(emptyFilters)}
        >
          清除筛选
        </Button>
      )}
    </div>
  );
}
