import type { components } from "@/lib/api-schema";

export type Action = Omit<components["schemas"]["ActivityAction"], "mode"> & {
  mode?: "queue" | "steer";
};
export type Question = {
  id: string;
  question: string;
  detail?: string;
  multiSelect?: boolean;
  options?: { label: string; description?: string }[];
};
export type Request = {
  id: string;
  kind: "approval" | "question";
  sessionId: string;
  toolName?: string;
  reason?: string;
  questions?: Question[];
};
export type Item = { id: string; content: { type: string; text?: string }[] };
export type Child = {
  id: string;
  label?: string;
  mode: string;
  kind?: string;
  depth?: number;
  running: boolean;
  projections?: {
    values?: {
      subagentTiming?: { settledMs: number; lastTurnCompleted?: boolean };
    };
  };
};
export type Activity = {
  requests: Request[];
  inbox: { "next-turn": Item[]; "next-step": Item[] };
  children: Child[];
};
