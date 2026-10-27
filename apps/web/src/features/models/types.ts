export type Profile = {
  key: string;
  name: string;
  id: string;
  base_url: string;
  api: string;
  provider: string;
  thinking_format: string | null;
  reasoning_efforts: Record<string, string | null> | null;
  supported_efforts: string[];
  has_key?: boolean;
};
export type Catalog = { models: Profile[]; default: string; revision: string };
export type Probe = { ok: boolean; efforts: { id: string; name: string }[] };
export const effortNames: Record<string, string> = {
  off: "关闭",
  low: "低",
  medium: "中",
  high: "高",
  max: "最高",
  xhigh: "极高",
  minimal: "极低",
};
