import { fetchJson } from "./http";
import type { BackupFrontendState } from "../lib/backupState";

export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

export interface RestoreStatus {
  can_restore: boolean;
  active_index_runs: number;
  active_translation_requests: number;
  active_maintenance_tasks?: MaintenanceTaskSnapshot[];
  data_dir?: string;
}

export interface RestoreResult {
  ok: boolean;
  pre_restore_backup: string;
  frontend_state?: unknown;
  data_dir?: string;
}

export type MaintenanceTaskStatus =
  | "idle"
  | "preparing"
  | "running"
  | "saving"
  | "completed"
  | "failed"
  | "cancelled";

export interface MaintenanceTaskSnapshot {
  task_id: string;
  kind: "backup_export" | "backup_restore" | "logs_export";
  status: MaintenanceTaskStatus;
  phase: string;
  percent: number | null;
  message: string;
  cancellable: boolean;
  created_at: string;
  started_at: string;
  finished_at: string;
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface MaintenanceTaskSaveResult {
  ok: boolean;
  saved_path: string;
  bytes: number;
  filename: string;
}

export interface MaintenanceTaskDiscardResult {
  ok: boolean;
}

export interface FrontendLogPayload {
  level: "error" | "warning" | "info";
  source: string;
  message: string;
  stack?: string;
  url?: string;
  user_agent?: string;
}

function filenameFromDisposition(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].replace(/\+/g, "%20"));
  }
  const plainMatch = value.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] || fallback;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string; message?: string };
    if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail;
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  } catch {
    // ignore parse errors and use fallback
  }
  return fallback;
}

async function readDownload(response: Response, fallbackFilename: string): Promise<DownloadedFile> {
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "下载失败"));
  }
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("Content-Disposition"), fallbackFilename),
  };
}

export function getRestoreStatus(): Promise<RestoreStatus> {
  return fetchJson<RestoreStatus>("/api/export/backup/restore/status");
}

export async function downloadDataBackup(frontendState: BackupFrontendState): Promise<DownloadedFile> {
  const response = await fetch("/api/export/backup/all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frontend_state: frontendState }),
  });
  return readDownload(response, "backup_all.zip");
}

export async function createBackupTask(frontendState: BackupFrontendState): Promise<MaintenanceTaskSnapshot> {
  return fetchJson<MaintenanceTaskSnapshot>("/api/export/backup/tasks", {
    method: "POST",
    body: JSON.stringify({ frontend_state: frontendState }),
  });
}

export async function restoreDataBackup(file: File): Promise<RestoreResult> {
  const form = new FormData();
  form.append("archive", file);
  const response = await fetch("/api/export/backup/restore", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "恢复失败"));
  }
  return (await response.json()) as RestoreResult;
}

export async function createRestoreTask(file: File): Promise<MaintenanceTaskSnapshot> {
  const form = new FormData();
  form.append("archive", file);
  const response = await fetch("/api/export/backup/restore/tasks", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "恢复任务创建失败"));
  }
  return (await response.json()) as MaintenanceTaskSnapshot;
}

export async function createRestoreTaskFromPath(sourcePath: string): Promise<MaintenanceTaskSnapshot> {
  return fetchJson<MaintenanceTaskSnapshot>("/api/export/backup/restore/tasks/from_path", {
    method: "POST",
    body: JSON.stringify({ source_path: sourcePath }),
  });
}

export async function downloadLogBundle(): Promise<DownloadedFile> {
  const response = await fetch("/api/export/logs");
  return readDownload(response, "diagnostics.zip");
}

export async function createLogExportTask(): Promise<MaintenanceTaskSnapshot> {
  return fetchJson<MaintenanceTaskSnapshot>("/api/export/logs/tasks", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getMaintenanceTask(taskId: string): Promise<MaintenanceTaskSnapshot> {
  return fetchJson<MaintenanceTaskSnapshot>(`/api/export/tasks/${encodeURIComponent(taskId)}`);
}

export function cancelMaintenanceTask(taskId: string): Promise<MaintenanceTaskSnapshot> {
  return fetchJson<MaintenanceTaskSnapshot>(`/api/export/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function downloadMaintenanceTaskArtifact(taskId: string): Promise<DownloadedFile> {
  const response = await fetch(`/api/export/tasks/${encodeURIComponent(taskId)}/download`);
  return readDownload(response, "artifact.zip");
}

export function saveMaintenanceTaskArtifact(taskId: string, targetPath: string): Promise<MaintenanceTaskSaveResult> {
  return fetchJson<MaintenanceTaskSaveResult>(`/api/export/tasks/${encodeURIComponent(taskId)}/save`, {
    method: "POST",
    body: JSON.stringify({ target_path: targetPath }),
  });
}

export function discardMaintenanceTaskArtifact(taskId: string): Promise<MaintenanceTaskDiscardResult> {
  return fetchJson<MaintenanceTaskDiscardResult>(`/api/export/tasks/${encodeURIComponent(taskId)}/discard`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function recordFrontendLog(payload: FrontendLogPayload): void {
  void fetch("/api/system/frontend_log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Logging must never create another visible failure.
  });
}
