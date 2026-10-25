import { lazy, Suspense, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { LogOut, Plus, MessageSquare } from "lucide-react";
import { api, login } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TooltipProvider } from "@/components/ui/tooltip";
const Chat = lazy(() =>
  import("@/features/chat/Chat").then((m) => ({ default: m.Chat })),
);
import { useChat } from "@/features/chat/store";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function Workspace() {
  const query = useQueryClient();
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useChat((s) => s.status === "running");
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await api.GET("/api/me");
      return data ?? null;
    },
  });
  const conversations = useQuery({
    queryKey: ["conversations"],
    enabled: !!me.data,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/conversations");
      if (error) throw new Error("加载对话列表失败");
      return data ?? [];
    },
  });
  function clearSession() {
    setId(null);
    useChat.getState().reset();
    query.clear();
    query.setQueryData(["me"], null);
  }
  async function newChat() {
    setBusy(true);
    setError("");
    try {
      const { data, error } = await api.POST("/api/conversations");
      if (error || !data) throw new Error("创建对话失败");
      setId(data.id);
      await query.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (me.isLoading)
    return (
      <main className="grid min-h-dvh place-items-center">
        正在连接 OrchMesh…
      </main>
    );
  if (!me.data)
    return (
      <main className="grid min-h-dvh place-items-center bg-muted/30 p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl">
              <h1>OrchMesh</h1>
            </CardTitle>
            <CardDescription>你的 Pi 工作空间 · 登录后继续</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              id="login"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                const form = new FormData(e.currentTarget);
                try {
                  await login(
                    String(form.get("email")),
                    String(form.get("password")),
                  );
                  await query.invalidateQueries({ queryKey: ["me"] });
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">邮箱</FieldLabel>
                  <Input
                    autoComplete="username"
                    id="email"
                    name="email"
                    type="email"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">密码</FieldLabel>
                  <Input
                    autoComplete="current-password"
                    id="password"
                    name="password"
                    type="password"
                    required
                  />
                </Field>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button
              className="w-full"
              form="login"
              type="submit"
              disabled={busy}
            >
              {busy ? "正在登录…" : "登录"}
            </Button>
            <p className="text-xs text-muted-foreground">
              仅限已由管理员创建的账号。
            </p>
          </CardFooter>
        </Card>
      </main>
    );
  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-5">
        <div className="flex items-center gap-3">
          <span className="font-semibold tracking-tight">OrchMesh</span>
          <span className="text-xs text-muted-foreground">Pi 工作空间</span>
        </div>
        <Button
          variant="ghost"
          onClick={async () => {
            const { error } = await api.POST("/api/auth/logout");
            if (!error) clearSession();
            else setError("退出失败，请重试。");
          }}
        >
          <LogOut data-icon="inline-start" />
          退出
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-48 shrink-0 flex-col gap-4 border-r bg-muted/20 p-3 sm:w-64">
          <Button
            variant="outline"
            disabled={running || busy}
            onClick={newChat}
          >
            <Plus data-icon="inline-start" />
            新对话
          </Button>
          <nav
            aria-label="对话列表"
            className="flex flex-1 flex-col gap-1 overflow-auto"
          >
            {conversations.data?.map((c) => (
              <Button
                key={c.id}
                variant={id === c.id ? "secondary" : "ghost"}
                className="justify-start"
                disabled={running && id !== c.id}
                onClick={() => {
                  setError("");
                  setId(c.id);
                }}
              >
                <MessageSquare data-icon="inline-start" />
                <span className="truncate">{c.title}</span>
              </Button>
            ))}
          </nav>
          <span className="truncate text-xs text-muted-foreground">
            {me.data.email}
          </span>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          {(error || conversations.error) && (
            <Alert variant="destructive">
              <AlertDescription>
                {error || conversations.error?.message}
              </AlertDescription>
            </Alert>
          )}
          {id ? (
            <Suspense fallback={<p className="p-6">正在加载对话…</p>}>
              <Chat key={id} id={id} onUnauthorized={clearSession} />
            </Suspense>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <h1 className="text-2xl font-semibold">把想法交给 Pi</h1>
              <p className="text-muted-foreground">
                开始新对话，或从左侧继续之前的工作。
              </p>
              <Button onClick={newChat} disabled={busy}>
                开始对话
              </Button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Workspace />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
