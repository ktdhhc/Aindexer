import { fetchJson } from "./http";

export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

export interface LatestDesktopUpdateInfo {
  repo: string;
  source: string;
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_name: string;
  release_url: string;
  published_at: string;
  body: string;
  prerelease: boolean;
  draft: boolean;
  download_url: string;
  download_filename: string;
  download_size: number;
  checked_at: string;
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

function buildUpdateQuery(currentVersion?: string, forceRefresh?: boolean): string {
  const params = new URLSearchParams();
  if (currentVersion) {
    params.set("current_version", currentVersion);
  }
  if (forceRefresh) {
    params.set("force_refresh", "true");
  }
  const query = params.toString();
  return query ? `/api/system/updates/latest?${query}` : "/api/system/updates/latest";
}

export function getLatestDesktopUpdate(currentVersion?: string, forceRefresh = false): Promise<LatestDesktopUpdateInfo> {
  return fetchJson<LatestDesktopUpdateInfo>(buildUpdateQuery(currentVersion, forceRefresh));
}

export async function downloadLatestDesktopInstaller(): Promise<DownloadedFile> {
  const response = await fetch("/api/system/updates/latest/download");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "下载安装包失败"));
  }
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(
      response.headers.get("Content-Disposition"),
      "Aindexer-latest-setup.exe",
    ),
  };
}
