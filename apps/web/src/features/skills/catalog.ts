import { useQuery } from "@tanstack/react-query";
import { platformRequest } from "@/lib/platform";
export type Skill = {
  id: string;
  name: string;
  description: string;
  source: string;
  revision: string;
  enabled: boolean;
};
export type Detail = Skill & {
  files: Record<string, string>;
  used_by: { id: string; name: string }[];
  definition: {
    content: string;
    warnings: string[];
    invocation: { modelInvocable: boolean; userInvocable: boolean };
  };
};
export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: ({ signal }) =>
      platformRequest<Skill[]>("/skills", "GET", undefined, signal),
  });
}
export function decode(value: string) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}
