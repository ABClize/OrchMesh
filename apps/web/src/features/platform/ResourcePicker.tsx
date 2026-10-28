import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Resource = {
  id: string;
  name: string;
  description?: string;
  disabled?: boolean;
};
export function ResourcePicker({
  title,
  items,
  selected,
  onAdd,
  onRemove,
  disabled,
  extra,
}: {
  title: string;
  items: Resource[];
  selected: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
  extra?: (id: string) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const available = items.filter(
    (i) =>
      !selected.includes(i.id) &&
      !i.disabled &&
      (i.name + i.description).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{title}</h3>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => setOpen(!open)}
        >
          {open ? "收起" : `添加${title}`}
        </Button>
      </div>
      {selected.length === 0 && (
        <p className="text-sm text-muted-foreground">尚未添加{title}</p>
      )}
      {selected.map((id) => {
        const item = items.find((i) => i.id === id);
        return (
          <div
            key={id}
            className="flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0">
              <p className="text-sm">
                {item?.name ?? "暂不可用的内容"}
                {item?.disabled && "（已停用）"}
              </p>
              {extra?.(id)}
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              aria-label={`移除 ${item?.name ?? id}`}
              onClick={() => onRemove(id)}
            >
              移除
            </Button>
          </div>
        );
      })}
      {open && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <Input
            aria-label={`搜索${title}`}
            placeholder="搜索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex max-h-60 flex-col gap-2 overflow-y-auto">
            {available.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 p-2"
              >
                <div className="min-w-0">
                  <p className="text-sm">{item.name}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {item.description}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  aria-label={`添加 ${item.name}`}
                  onClick={() => onAdd(item.id)}
                >
                  添加
                </Button>
              </div>
            ))}
            {!available.length && (
              <p className="text-sm text-muted-foreground">
                没有可添加的{title}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
