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

export async function pickDesktopSavePath(options: SaveWithDesktopDialogOptions): Promise<string | null> {
  if (!isDesktopShell()) {
    return null;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const targetPath = await invoke<string | null>("pick_save_path", {
    title: options.title,
    defaultPath: options.defaultPath,
    filters: options.filters ?? [],
  });
  return targetPath || null;
}

export async function writeDownloadedFileToPath(file: DownloadedFile, targetPath: string): Promise<string | null> {
  if (!isDesktopShell()) {
    saveWithBrowserDownload(file);
    return null;
  }
  const { stat, writeFile } = await import("@tauri-apps/plugin-fs");
  const bytes = new Uint8Array(await file.blob.arrayBuffer());
  await writeFile(targetPath, bytes);
  const written = await stat(targetPath);
  if (Number(written.size || 0) !== bytes.byteLength) {
    throw new Error("Saved file size mismatch");
  }
  return targetPath;
}

export async function saveDownloadedFile(file: DownloadedFile, options: SaveWithDesktopDialogOptions): Promise<string | null> {
  if (!isDesktopShell()) {
    saveWithBrowserDownload(file);
    return null;
  }
  const targetPath = await pickDesktopSavePath(options);
  if (!targetPath) {
    return null;
  }
  return writeDownloadedFileToPath(file, targetPath);
}

export async function pickDesktopOpenPath(options: OpenWithDesktopDialogOptions): Promise<string | null> {
  if (!isDesktopShell()) {
    return null;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const selectedPath = await invoke<string | null>("pick_open_file", {
    title: options.title,
    filters: options.filters ?? [],
  });
  return selectedPath || null;
}

export async function confirmDesktopAction(message: string, title: string): Promise<boolean> {
  if (!isDesktopShell()) {
    return window.confirm(message);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("confirm_desktop_action", {
    message,
    title,
  });
}

export async function revealDesktopPath(path: string): Promise<void> {
  if (!isDesktopShell() || !path) {
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reveal_in_folder", { path });
}

export async function launchDesktopInstallerAndExit(path: string): Promise<void> {
  if (!isDesktopShell() || !path) {
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("launch_installer_and_exit", { path });
}
