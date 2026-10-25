import createClient from "openapi-fetch";
import type { paths } from "./api-schema";
import { expireToken, getToken, setToken } from "./session";

export const api = createClient<paths>({ baseUrl: "", credentials: "omit" });
api.use({
  onRequest({ request }) {
    const token = getToken();
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    return request;
  },
  onResponse({ request, response }) {
    if (response.status === 401)
      expireToken(request.headers.get("Authorization")?.slice(7) ?? null);
    return response;
  },
});

export async function login(email: string, password: string) {
  const response = await fetch("/api/login/access-token", {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: email, password }),
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "尝试过于频繁，请稍后再试。"
        : response.status >= 500
          ? "登录服务暂时不可用，请稍后再试。"
          : "登录失败，请检查邮箱和密码。",
    );
  const value: { access_token: string } = await response.json();
  setToken(value.access_token);
}
