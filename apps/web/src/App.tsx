import { Navigation } from "@/features/conversations/Navigation";
import { ReasoningSettings } from "@/features/chat/ReasoningSettings";
import { SidebarLayout } from "@/features/workspace/SidebarLayout";
import { Workbench } from "@/features/workspace/Workbench";
import { useFiles } from "@/features/workspace/files";
import { lazy, Suspense, useState, useEffect } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  LogOut,
  Layers,
  PanelLeft,
  ChevronsUpDown,
  SquarePen,
  UserRound,
} from "lucide-react";
import { api } from "@/lib/api";
import { setToken, watchSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Button as AffectButton } from "@/components/ui/button-clean";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { createConversation } from "@/features/chat/commands";
import { ProfileMenu } from "@/components/ui/profile-menu";
import { ThinkingLoader } from "@/components/ui/thinking-loader";
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
const DraftChat = lazy(() =>
  import("@/features/chat/DraftChat").then((m) => ({ default: m.DraftChat })),
);
import { useAuth } from "@/features/auth/useAuth";
import { useChat } from "@/features/chat/store";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function Workspace() {
  const query = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showConversations, setShowConversations] = useState(false);
  const filesOpen = useFiles((s) => s.open);
  const [starting, setStarting] = useState(false);
  const running = useChat((s) => s.status === "running");
  const { me, signIn } = useAuth();
  const conversations = useQuery({
    queryKey: ["conversations"],
    enabled: !!me.data,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/conversations", { signal });
      if (error) throw new Error("加载对话列表失败");
      return data ?? [];
    },
  });
  const projects = useQuery({
    queryKey: ["projects"],
    enabled: !!me.data,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/projects", { signal });
      if (error || !data) throw new Error("项目读取失败");
      return data;
    },
  });
  const currentConversation = conversations.data?.find((c) => c.id === id);
  const workspaceId = id
    ? (currentConversation?.directory_id ?? null)
    : projectId;
  useEffect(() => {
    useFiles.getState().setProject(workspaceId);
  }, [workspaceId]);
  useEffect(
    () =>
      watchSession(() => {
        setId(null);
        setProjectId(null);
        setStarting(false);
        useChat.getState().reset();
        query.clear();
        void query.invalidateQueries({ queryKey: ["me"] });
      }),
    [query],
  );
  function clearSession() {
    setStarting(false);
    setToken(null);
    setProjectId(null);
    setId(null);
    useChat.getState().reset();
    query.clear();
    query.setQueryData(["me"], null);
  }
  const createChat = useMutation({
    mutationFn: () => createConversation(projectId),
    onSuccess: async (data) => {
      setShowArchived(false);
      setId(data.id);
      setShowConversations(false);
      await query.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
  const busy = signIn.isPending || createChat.isPending || starting;
  const newChat = () => {
    setError("");
    createChat.mutate();
  };
  if (me.isError)
    return (
      <main className="grid min-h-dvh place-items-center">
        <Alert className="max-w-md" variant="destructive">
          <AlertDescription>
            无法连接服务，请检查服务状态后重试。
          </AlertDescription>
          <Button onClick={() => void me.refetch()}>重试</Button>
        </Alert>
      </main>
    );
  if (me.isLoading)
    return (
      <main className="grid min-h-dvh place-items-center">
        <ThinkingLoader phases={["正在连接 OrchMesh"]} phase={0} />
      </main>
    );
  if (!me.data)
    return (
      <main className="grid min-h-dvh place-items-center bg-sidebar p-6">
        <Card className="login-card w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl">
              <h1 className="flex items-center gap-3">
                <Layers aria-hidden="true" />
                OrchMesh
              </h1>
            </CardTitle>
            <CardDescription>从这里，继续你的工作。</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              id="login"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                signIn.mutate({
                  email: String(form.get("email")),
                  password: String(form.get("password")),
                });
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
                {signIn.error && (
                  <Alert variant="destructive">
                    <AlertDescription>{signIn.error.message}</AlertDescription>
                  </Alert>
                )}
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <AffectButton
              size="lg"
              loading={busy}
              className="w-full"
              form="login"
              type="submit"
              disabled={busy}
            >
              {busy ? "正在登录…" : "登录工作空间"}
            </AffectButton>
            <p className="text-xs text-muted-foreground">
              仅限已由管理员创建的账号。
            </p>
          </CardFooter>
        </Card>
      </main>
    );
  return (
    <div
      className="workspace-layout"
      data-sidebar-open={showConversations}
      data-files-open={filesOpen}
    >
      <SidebarLayout
        showConversations={showConversations}
        sidebar={
          <aside id="conversations" className="workspace-sidebar">
            <div className="sidebar-brand">
              <span className="brand-mark">
                <Layers aria-hidden="true" />
              </span>
              <span>OrchMesh</span>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto md:hidden"
                aria-label="关闭对话列表"
                onClick={() => setShowConversations(false)}
              >
                <PanelLeft />
              </Button>
            </div>
            <AffectButton
              variant="secondary"
              size="lg"
              className="sidebar-new"
              icon={<SquarePen />}
              disabled={running || busy}
              onClick={newChat}
            >
              新对话
            </AffectButton>
            <Navigation
              archived={showArchived}
              setArchived={setShowArchived}
              conversations={conversations.data ?? []}
              id={id}
              projectId={projectId}
              busy={running || busy}
              onSelect={(conversation) => {
                setError("");
                setId(conversation.id);
                setProjectId(conversation.project_id);
                setShowConversations(false);
              }}
              onProject={(project) => {
                setShowArchived(false);
                setId(null);
                setProjectId(project);
                setError("");
                useChat.getState().reset();
                setShowConversations(false);
              }}
              onArchive={(archivedId) => {
                if (id === archivedId) {
                  setId(null);
                  useChat.getState().reset();
                }
              }}
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  className="account-trigger"
                  aria-label="账户菜单"
                >
                  <span className="account-avatar">
                    <UserRound />
                  </span>
                  <span className="flex flex-1 flex-col items-start gap-0.5">
                    <span>我的工作空间</span>
                    <span className="text-xs text-muted-foreground">
                      个人账户
                    </span>
                  </span>
                  <ChevronsUpDown />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="start"
                className="account-popover"
              >
                <ProfileMenu
                  name="我的工作空间"
                  email={me.data.email}
                  items={[
                    {
                      id: "logout",
                      label: "退出登录",
                      icon: <LogOut />,
                      onSelect: clearSession,
                    },
                  ]}
                />
              </PopoverContent>
            </Popover>
          </aside>
        }
      >
        <Workbench>
          <main className="workspace-main">
            <header className="chat-header">
              <Button
                variant="ghost"
                size="icon"
                className="workbench-nav-toggle"
                aria-label="切换对话列表"
                aria-expanded={showConversations}
                aria-controls="conversations"
                onClick={() => setShowConversations(!showConversations)}
              >
                <PanelLeft />
              </Button>
              <span className="min-w-0 flex-1 truncate">
                {id
                  ? (conversations.data?.find((c) => c.id === id)?.title ??
                    "新对话")
                  : "工作空间"}
              </span>
              {id && (
                <ReasoningSettings
                  id={id}
                  value={
                    conversations.data?.find((c) => c.id === id)?.reasoning ??
                    "default"
                  }
                  running={running}
                />
              )}
              <Button
                variant="outline"
                size="sm"
                aria-expanded={filesOpen}
                onClick={() =>
                  filesOpen
                    ? useFiles.getState().close()
                    : useFiles.getState().show()
                }
              >
                工作区文件
              </Button>
            </header>
            {id && workspaceId !== projectId && (
              <p className="px-6 py-2 text-xs text-muted-foreground">
                会话文件目录：
                {projects.data?.find((p) => p.id === workspaceId)?.name ??
                  "原文件目录"}
                。文件面板与 Agent 均使用该目录。
              </p>
            )}
            {(error || createChat.error || conversations.error) && (
              <Alert variant="destructive">
                <AlertDescription>
                  {error ||
                    createChat.error?.message ||
                    conversations.error?.message}
                </AlertDescription>
              </Alert>
            )}
            {id ? (
              <Suspense fallback={<p className="p-6">正在加载对话…</p>}>
                <Chat
                  key={
                    id +
                    String(
                      conversations.data?.find((c) => c.id === id)?.archived,
                    )
                  }
                  id={id}
                  onUnauthorized={clearSession}
                />
              </Suspense>
            ) : (
              <Suspense fallback={<p className="p-6">正在准备工作空间…</p>}>
                <DraftChat
                  key={projectId ?? "default"}
                  projectId={projectId}
                  onBusyChange={setStarting}
                  onStarted={(conversationId) => {
                    setShowArchived(false);
                    setId(conversationId);
                    setShowConversations(false);
                    void query.invalidateQueries({
                      queryKey: ["conversations"],
                    });
                  }}
                />
              </Suspense>
            )}
          </main>
        </Workbench>
      </SidebarLayout>
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
