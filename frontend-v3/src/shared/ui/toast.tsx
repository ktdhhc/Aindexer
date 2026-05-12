import { create } from "zustand";

type ToastTone = "success" | "info" | "warning" | "error";

interface ToastInput {
  tone?: ToastTone;
  title: string;
  message?: string;
  durationMs?: number;
}

interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastState {
  items: ToastItem[];
  push: (toast: ToastInput) => string;
  remove: (id: string) => void;
}

function createToastId(): string {
  return crypto.randomUUID?.() || `toast_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (toast) => {
    const id = createToastId();
    const item: ToastItem = {
      id,
      tone: toast.tone ?? "info",
      title: toast.title,
      message: toast.message,
    };
    set((state) => ({
      items: [...state.items.slice(-3), item],
    }));
    const durationMs = toast.durationMs ?? (item.tone === "error" ? 5000 : 1800);
    if (durationMs > 0) {
      window.setTimeout(() => {
        get().remove(id);
      }, durationMs);
    }
    return id;
  },
  remove: (id) => {
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
    }));
  },
}));

export function notifyToast(toast: ToastInput): string {
  return useToastStore.getState().push(toast);
}

export function ToastHost() {
  const items = useToastStore((state) => state.items);
  const remove = useToastStore((state) => state.remove);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="v35-toast-host" role="status" aria-live="polite" aria-atomic="false">
      {items.map((item) => (
        <article className={`v35-toast is-${item.tone}`} key={item.id}>
          <div>
            <strong>{item.title}</strong>
            {item.message ? <p>{item.message}</p> : null}
          </div>
          <button type="button" aria-label="关闭提示" onClick={() => remove(item.id)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4.5 4.5 11.5 11.5" />
              <path d="m11.5 4.5-7 7" />
            </svg>
          </button>
        </article>
      ))}
    </div>
  );
}
