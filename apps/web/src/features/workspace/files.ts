import { create } from "zustand";
import { api } from "../../lib/api";

export const useFiles = create<{
  projectId: string | null;
  setProject: (id: string | null) => void;
  open: boolean;
  path: string | null;
  tabs: string[];
  folder: string;
  show: (path?: string) => void;
  close: () => void;
  closeTab: (path: string) => void;
  setFolder: (folder: string) => void;
  reset: () => void;
}>((set) => ({
  projectId: null,
  setProject: (projectId) =>
    set((state) =>
      state.projectId === projectId
        ? {}
        : { projectId, path: null, tabs: [], folder: "" },
    ),
  open: false,
  path: null,
  tabs: [],
  folder: "",
  show: (path) =>
    set((state) => ({
      open: true,
      ...(path
        ? {
            path,
            tabs: state.tabs.includes(path)
              ? state.tabs
              : [...state.tabs, path],
          }
        : {}),
    })),
  close: () => set({ open: false }),
  closeTab: (path) =>
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab !== path);
      const index = state.tabs.indexOf(path);
      return {
        tabs,
        path:
          state.path === path
            ? (tabs[Math.min(index, tabs.length - 1)] ?? null)
            : state.path,
      };
    }),
  setFolder: (folder) => set({ folder }),
  reset: () =>
    set({ projectId: null, open: false, path: null, tabs: [], folder: "" }),
}));

export async function fetchFile(path: string, signal?: AbortSignal) {
  const { data, error, response } = await api.GET("/api/workspace/file", {
    params: { query: { path, project_id: useFiles.getState().projectId } },
    parseAs: "blob",
    signal,
  });
  if (error || !data)
    throw new Error(
      response.status === 413
        ? "文件超过 20 MiB 限制。"
        : "无法读取文件，可能已移动、删除或登录已过期。",
    );
  return data;
}
export async function downloadFile(path: string) {
  const blob = await fetchFile(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = path.split("/").at(-1) ?? "download";
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function deliveredFiles(
  result: unknown,
): { path: string; name: string; size?: number; description?: string }[] {
  try {
    const content = Array.isArray(result) ? result : [];
    const text = content
      .map((part) => (part?.type === "text" ? part.text : ""))
      .join("");
    const value = JSON.parse(typeof result === "string" ? result : text);
    if (value.kind === "dsh.deliverables" && Array.isArray(value.files)) {
      return value.files.flatMap(
        (file: { path?: unknown; description?: unknown }) => {
          if (typeof file.path !== "string") return [];
          const prefix = [
            `/workspaces/${useFiles.getState().projectId ?? "default"}/`,
            "/workspace/",
          ].find((root) => (file.path as string).startsWith(root));
          if (!prefix) return [];
          const path = file.path.slice(prefix.length);
          if (
            path.includes("\\") ||
            path.includes("\0") ||
            path
              .split("/")
              .some((part) => !part || part === "." || part === "..")
          )
            return [];
          return [
            {
              path,
              name: path.split("/").at(-1)!,
              ...(typeof file.description === "string"
                ? { description: file.description }
                : {}),
            },
          ];
        },
      );
    }
    if (value.kind !== "orchmesh.files.v1" || !Array.isArray(value.files))
      return [];
    return value.files
      .filter(
        (f: { path?: unknown; name?: unknown; size?: unknown }) =>
          typeof f.path === "string" &&
          typeof f.name === "string" &&
          typeof f.size === "number",
      )
      .slice(0, 20);
  } catch {
    return [];
  }
}
