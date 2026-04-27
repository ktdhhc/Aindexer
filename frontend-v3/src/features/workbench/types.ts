import type { FileItem } from "../../shared/api/files";

export interface WorkbenchStats {
  total: number;
  indexed: number;
  running: number;
  review: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  meta?: string;
}

export type PreviewMode = "rendered" | "raw";

export interface QueueItemView {
  row: FileItem;
  running: boolean;
  label: string;
  tone: "ok" | "warn" | "error" | "muted" | "default";
}
