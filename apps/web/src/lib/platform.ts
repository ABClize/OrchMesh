import { expireToken, getToken } from "./session";
export async function platformRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const token = getToken();
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    credentials: "omit",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined || body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(body === undefined
      ? {}
      : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
  if (response.status === 401) expireToken(token);
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "登录已过期，请重新登录。"
        : response.status === 404
          ? "无法访问此记录，可能不存在或没有权限。"
          : `请求失败 (${response.status})，请稍后重试。`,
    );
  return response.json();
}
