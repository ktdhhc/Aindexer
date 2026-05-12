import { fetchJson } from "./http";

export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

export interface DownloadProgressState {
  receivedBytes: number;
  totalBytes: number;
  percent: number | null;
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

export async function downloadLatestDesktopInstaller(
  currentVersion: string,
  onProgress?: (state: DownloadProgressState) => void,
  signal?: AbortSignal,
): Promise<DownloadedFile> {
  const params = new URLSearchParams({ current_version: currentVersion });
  const response = await fetch(`/api/system/updates/latest/download?${params.toString()}`, { signal });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "下载安装包失败"));
  }

  const fallbackFilename = "Aindexer-latest-setup.exe";
  const filename = filenameFromDisposition(
    response.headers.get("Content-Disposition"),
    fallbackFilename,
  );
  const totalBytes = Number.parseInt(response.headers.get("Content-Length") || "0", 10) || 0;

  if (!response.body) {
    const blob = await response.blob();
    onProgress?.({
      receivedBytes: blob.size,
      totalBytes,
      percent: totalBytes > 0 ? 100 : null,
    });
    return { blob, filename };
  }

  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    receivedBytes += value.byteLength;
    onProgress?.({
      receivedBytes,
      totalBytes,
      percent: totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : null,
    });
  }

  return {
    blob: new Blob(chunks, { type: response.headers.get("Content-Type") || "application/octet-stream" }),
    filename,
  };
}
