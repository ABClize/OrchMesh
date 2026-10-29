import { ThemeToggle } from "@/features/workspace/ThemeToggle";

export function PersonalSettings() {
  return (
    <div className="mx-auto w-full max-w-3xl p-8">
      <h1 className="text-xl font-semibold">设置</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        调整此浏览器的使用偏好。
      </p>
      <div className="mt-8 flex items-center justify-between border-b pb-5">
        <div>
          <h2 className="font-medium">外观</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            切换浅色或深色主题，自动保存。
          </p>
        </div>
        <ThemeToggle />
      </div>
    </div>
  );
}
