import type { DownloadedFile } from "../api/backup";
import { isDesktopShell } from "./runtime";

export interface NativeDialogFilter {
  name: string;
  extensions: string[];
}

interface SaveWithDesktopDialogOptions {
  title: string;
  defaultPath: string;
  filters?: NativeDialogFilter[];
}

interface OpenWithDesktopDialogOptions {
  title: string;
  filters?: NativeDialogFilter[];
  mimeType?: string;
}

function fileNameFromPath(path: string): string {
  const parts = String(path || "").split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "download";
}

function saveWithBrowserDownload(file: DownloadedFile): void {
  const url = window.URL.createObjectURL(file.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

export async function saveDownloadedFile(file: DownloadedFile, options: SaveWithDesktopDialogOptions): Promise<string | null> {
  if (!isDesktopShell()) {
    saveWithBrowserDownload(file);
    return null;
  }
  const [{ save }, { writeFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const targetPath = await save({
    title: options.title,
    defaultPath: options.defaultPath,
    filters: options.filters,
  });
  if (!targetPath) {
    return null;
  }
  await writeFile(targetPath, new Uint8Array(await file.blob.arrayBuffer()));
  return targetPath;
}

export async function openFileWithDesktopDialog(options: OpenWithDesktopDialogOptions): Promise<File | null> {
  if (!isDesktopShell()) {
    return null;
  }
  const [{ open }, { readFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const selectedPath = await open({
    title: options.title,
    multiple: false,
    directory: false,
    filters: options.filters,
  });
  if (typeof selectedPath !== "string" || !selectedPath) {
    return null;
  }
  const content = await readFile(selectedPath);
  const bytes = new Uint8Array(content);
  return new File([bytes.buffer], fileNameFromPath(selectedPath), {
    type: options.mimeType || "application/octet-stream",
  });
}

export async function confirmDesktopAction(message: string, title: string): Promise<boolean> {
  if (!isDesktopShell()) {
    return window.confirm(message);
  }
  const { confirm } = await import("@tauri-apps/plugin-dialog");
  return confirm(message, {
    title,
    kind: "warning",
    okLabel: "继续",
    cancelLabel: "取消",
  });
}

export async function revealDesktopPath(path: string): Promise<void> {
  if (!isDesktopShell() || !path) {
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reveal_in_folder", { path });
}
