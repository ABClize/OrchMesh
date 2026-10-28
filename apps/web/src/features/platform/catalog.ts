import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
export type Agent = {
  id: string;
  name: string;
  description: string;
  published_version: string | null;
  draft: {
    name: string;
    description: string;
    instructions: string;
    tools?: string[];
    knowledge_ids?: string[];
    skills?: { id: string; revision: string }[];
  };
};
export type ContextItem = {
  id: string;
  content: string;
  title: string;
  enabled: boolean;
  agent_id: string | null;
};
export function useCatalogAction() {
  const query = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await query.invalidateQueries({
        predicate: (q) =>
          [
            "agents",
            "memory",
            "memory-settings",
            "knowledge",
            "comments",
          ].includes(String(q.queryKey[0])),
      });
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, action };
}
