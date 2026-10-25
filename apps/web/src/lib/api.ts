import createClient from "openapi-fetch";
import type { paths } from "./api-schema";

export const api = createClient<paths>({ baseUrl: "" });
api.use({
  async onRequest({ request }) {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const token = document.cookie
        .split("; ")
        .find((s) => s.startsWith("orchmesh_csrf="))
        ?.split("=")
        .slice(1)
        .join("=");
      if (token) request.headers.set("x-csrftoken", decodeURIComponent(token));
    }
    return request;
  },
});

export async function login(email: string, password: string) {
  await api.GET("/api/health");
  const token = document.cookie
    .split("; ")
    .find((s) => s.startsWith("orchmesh_csrf="))
    ?.slice("orchmesh_csrf=".length);
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-csrftoken": decodeURIComponent(token ?? ""),
    },
    body: new URLSearchParams({ username: email, password }),
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "尝试过于频繁，请稍后再试。"
        : "登录失败，请检查邮箱和密码。",
    );
}
