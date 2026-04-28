export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string; message?: string };
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail;
    }
    if (payload.detail && typeof payload.detail === "object") {
      const detail = payload.detail as { message?: string; error_message?: string; code?: string };
      if (typeof detail.message === "string" && detail.message.trim()) {
        return detail.message;
      }
      if (typeof detail.error_message === "string" && detail.error_message.trim()) {
        return detail.error_message;
      }
      if (typeof detail.code === "string" && detail.code.trim()) {
        return detail.code;
      }
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }
  } catch {
    // ignore parse error and fallback to status text
  }

  return response.statusText || "请求失败";
}
