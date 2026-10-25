import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, login } from "../../lib/api";

export async function currentUser(signal?: AbortSignal) {
  const { data, error, response } = await api.GET("/api/me", { signal });
  if (response.status === 401) return null;
  if (error || !data) throw new Error("服务暂时不可用，请重试。");
  return data;
}

export function useAuth() {
  const query = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => currentUser(signal),
  });
  const signIn = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      login(email, password),
    onSuccess: () => query.invalidateQueries({ queryKey: ["me"] }),
  });
  return { me, signIn };
}
