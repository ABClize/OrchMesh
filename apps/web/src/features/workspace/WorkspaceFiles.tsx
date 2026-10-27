import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Folder, FileText, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useChat } from "@/features/chat/store";
import { fetchFile, downloadFile, useFiles } from "./files";

export const HTML_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; script-src 'none'; connect-src 'none'";
export function isolatedHtml(text: string) {
  return (
    `<meta http-equiv="Content-Security-Policy" content="${HTML_POLICY}">` +
    text
  );
}

function Preview({ path }: { path: string }) {
  const [resource, setResource] = useState<{
    url: string;
    text: string;
    type: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let url = "";
    void fetchFile(path, abort.signal)
      .then(async (blob) => {
        const ext = path.split(".").at(-1)?.toLowerCase() ?? "";
        const image = ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);
        const type = image
          ? "image"
          : ext === "pdf"
            ? "pdf"
            : ["html", "htm"].includes(ext)
              ? "html"
              : ["md", "markdown"].includes(ext)
                ? "markdown"
                : [
                      "txt",
                      "csv",
                      "tsv",
                      "json",
                      "py",
                      "js",
                      "ts",
                      "tsx",
                      "jsx",
                      "css",
                      "yaml",
                      "yml",
                      "toml",
                      "sh",
                      "log",
                      "xml",
                      "sql",
                    ].includes(ext)
                  ? "text"
                  : "binary";
        if (
          !["image", "pdf", "binary"].includes(type) &&
          blob.size > 1024 * 1024
        )
          throw new Error("文本超过 1 MiB，暂不预览，请下载查看。");
        const text = ["image", "pdf", "binary"].includes(type)
          ? ""
          : await blob.text();
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(
          new Blob([blob], {
            type:
              type === "pdf"
                ? "application/pdf"
                : image
                  ? `image/${ext === "jpg" ? "jpeg" : ext}`
                  : "application/octet-stream",
          }),
        );
        setResource({ url, text, type });
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError((e as Error).message);
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate" title={path}>
          {path.split("/").at(-1)}
        </p>
        <Button
          variant="outline"
          disabled={downloading}
          onClick={async () => {
            setDownloading(true);
            try {
              await downloadFile(path);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setDownloading(false);
            }
          }}
        >
          下载文件
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!resource && !error && <p>正在读取文件…</p>}
      {resource?.type === "image" && (
        <img
          src={resource.url}
          alt={path}
          className="max-h-[75vh] object-contain"
        />
      )}
      {resource?.type === "pdf" && (
        <iframe
          title={path}
          src={resource.url}
          className="min-h-[65vh] w-full"
        />
      )}
      {resource?.type === "html" && (
        <>
          <p className="text-xs text-muted-foreground">
            隔离预览：脚本、外部资源和表单已禁用。
          </p>
          <iframe
            title={path}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={isolatedHtml(resource.text)}
            className="min-h-[65vh] w-full rounded border bg-white"
          />
        </>
      )}
      {resource?.type === "markdown" && (
        <div className="aui-md overflow-auto">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              img: () => <span>（图片请从工作区打开）</span>,
              a: ({ children }) => <span>{children}</span>,
            }}
          >
            {resource.text}
          </ReactMarkdown>
        </div>
      )}
      {resource?.type === "text" && (
        <pre className="overflow-auto rounded border bg-muted p-3 text-sm whitespace-pre-wrap break-all">
          {resource.text}
        </pre>
      )}
      {resource?.type === "binary" && (
        <p>此文件类型暂不支持预览，请下载查看。</p>
      )}
    </div>
  );
}

export function WorkspaceFiles({
  previewOnly = false,
}: {
  previewOnly?: boolean;
}) {
  const {
    open,
    path,
    tabs,
    folder,
    setFolder,
    closeTab,
    close,
    show,
    projectId,
  } = useFiles();
  const running = useChat((s) => s.status === "running");
  const listing = useQuery({
    queryKey: ["workspace", projectId, folder],
    enabled: open && !previewOnly,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/workspace/entries", {
        params: { query: { path: folder, project_id: projectId } },
        signal,
      });
      if (error || !data) throw new Error("目录读取失败，请刷新重试。");
      return data;
    },
    refetchInterval: open && !previewOnly && running ? 3000 : false,
  });
  return (
    <section
      className="flex h-full min-w-0 flex-col bg-background"
      aria-label="文件工作区"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Folder aria-hidden="true" className="size-4" />
        <h2 className="flex-1 text-sm font-medium">工作区</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="收起工作区"
          onClick={close}
        >
          <X />
        </Button>
      </header>
      {!previewOnly && (
        <nav
          aria-label="工作区目录"
          className="flex max-h-48 min-h-28 shrink-0 flex-col border-b"
        >
          <div className="flex items-center gap-1 px-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="上级目录"
              disabled={!folder}
              onClick={() =>
                setFolder(folder.split("/").slice(0, -1).join("/"))
              }
            >
              <ArrowLeft />
            </Button>
            <span
              className="min-w-0 flex-1 truncate text-xs"
              title={folder || "/"}
            >
              /{folder}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="刷新文件列表"
              onClick={() => void listing.refetch()}
            >
              <RefreshCw />
            </Button>
          </div>
          <div className="flex flex-col overflow-auto px-2 pb-2">
            {listing.isPending && <p className="p-2 text-sm">正在读取目录…</p>}
            {listing.error && <p role="alert">{listing.error.message}</p>}
            {listing.data?.entries.length === 0 && (
              <p className="p-2 text-sm text-muted-foreground">
                此目录还没有文件。
              </p>
            )}
            {listing.data?.truncated && (
              <p>仅显示前 500 项，请进入子目录查看。</p>
            )}
            {listing.data?.entries.map((entry) => (
              <Button
                key={entry.path}
                variant={path === entry.path ? "secondary" : "ghost"}
                className="justify-start"
                title={entry.path}
                onClick={() =>
                  entry.directory ? setFolder(entry.path) : show(entry.path)
                }
              >
                {entry.directory ? <Folder /> : <FileText />}
                <span className="min-w-0 truncate">{entry.name}</span>
              </Button>
            ))}
          </div>
        </nav>
      )}
      {path ? (
        <Tabs
          value={path}
          onValueChange={show}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="flex shrink-0 items-center gap-1 border-b px-2">
            <div className="min-w-0 flex-1 overflow-x-auto">
              <TabsList variant="line" aria-label="已打开文件">
                {tabs.map((file) => (
                  <TabsTrigger
                    key={file}
                    value={file}
                    title={file}
                    className="max-w-48"
                  >
                    <FileText className="size-4 shrink-0" />
                    <span className="truncate">{file.split("/").at(-1)}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="关闭当前文件"
              onClick={() => closeTab(path)}
            >
              <X />
            </Button>
          </div>
          {tabs.map((file) => (
            <TabsContent
              key={file}
              value={file}
              className="min-h-0 overflow-auto p-3"
            >
              <Preview key={file} path={file} />
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <div className="grid flex-1 place-content-center gap-2 p-6 text-center text-sm text-muted-foreground">
          <p>选择文件以预览</p>
          <p>也可以从聊天中的交付卡片打开文件。</p>
        </div>
      )}
    </section>
  );
}
