export type Row = {
  id: string;
  email?: string;
  is_active?: boolean;
  is_superuser?: boolean;
  name?: string;
  title?: string;
  description?: string;
  published_version?: string | null;
  owner?: string;
  status?: string;
  created_at?: string;
  conversation_id?: string;
  draft_skills?: string[];
  published_skills?: string[];
};
export type Overview = {
  counts: Record<string, number>;
  statuses: Record<string, number>;
  attached_workers: number;
};
