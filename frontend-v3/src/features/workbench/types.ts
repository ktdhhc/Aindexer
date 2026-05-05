export interface WorkbenchStats {
  total: number;
  indexed: number;
  running: number;
  review: number;
}

export interface KeywordStat {
  keyword: string;
  count: number;
}

export type PreviewMode = "rendered" | "raw";
