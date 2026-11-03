import { create } from "zustand";
import { errText, isNoTauriError } from "../lib/errors";

export type ToastKind = "error" | "success" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  /** 中文、动作化的一句话，例如「导入失败」。 */
  title: string;
  /** 原始技术细节（Rust `AppError` 的文案等）。可为空。 */
  detail?: string;
  /** 同一条消息重复出现时累加，而不是再推一条。 */
  count: number;
}

/** 同屏最多留这么多条，超了丢最旧的。 */
const MAX_TOASTS = 4;

const DURATION: Record<ToastKind, number> = {
  error: 7000,
  success: 3000,
  info: 4500,
};

interface ToastState {
  toasts: readonly Toast[];
  /** 鼠标停在 toast 堆上时为 true，自动消失暂停。 */
  paused: boolean;
  push: (kind: ToastKind, title: string, detail?: string) => void;
  dismiss: (id: number) => void;
  clear: () => void;
  pause: () => void;
  resume: () => void;
}

const EMPTY: readonly Toast[] = Object.freeze([]);

let nextId = 1;
/** id → setTimeout handle。放模块级而不是 store 里：计时器不是渲染状态。 */
const timers = new Map<number, number>();

function disarm(id: number) {
  const t = timers.get(id);
  if (t !== undefined) {
    window.clearTimeout(t);
    timers.delete(id);
  }
}

function arm(id: number, kind: ToastKind) {
  disarm(id);
  timers.set(
    id,
    window.setTimeout(() => {
      timers.delete(id);
      useToastStore.getState().dismiss(id);
    }, DURATION[kind]),
  );
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: EMPTY,
  paused: false,
  push: (kind, title, detail) => {
    const existing = get().toasts.find(
      (t) => t.kind === kind && t.title === title && t.detail === detail,
    );
    // 去重：一批导入里 100 个文件同样失败，不该刷 100 条 toast。
    if (existing) {
      set((s) => ({
        toasts: s.toasts.map((t) =>
          t.id === existing.id ? { ...t, count: t.count + 1 } : t,
        ),
      }));
      if (!get().paused) arm(existing.id, kind);
      return;
    }
    const id = nextId++;
    set((s) => {
      const next = [...s.toasts, { id, kind, title, detail, count: 1 }];
      while (next.length > MAX_TOASTS) {
        const dropped = next.shift();
        if (dropped) disarm(dropped.id);
      }
      return { toasts: next };
    });
    if (!get().paused) arm(id, kind);
  },
  dismiss: (id) => {
    disarm(id);
    set((s) => {
      const next = s.toasts.filter((t) => t.id !== id);
      return { toasts: next.length === 0 ? EMPTY : next };
    });
  },
  clear: () => {
    for (const t of get().toasts) disarm(t.id);
    set({ toasts: EMPTY });
  },
  pause: () => {
    for (const t of get().toasts) disarm(t.id);
    set({ paused: true });
  },
  // 注意：恢复是「重新从头计时」，不是接着剩余时间走。差别用户感知不到，
  // 换来的是不用为每条 toast 记录剩余毫秒。
  resume: () => {
    set({ paused: false });
    for (const t of get().toasts) arm(t.id, t.kind);
  },
}));

/** 给非 React 代码（store、事件回调）用的入口。组件里也可以直接用。 */
export const toast = {
  /** `cause` 是 catch 到的原始错误，会被归一化成副标题。 */
  error(title: string, cause?: unknown) {
    if (cause !== undefined && isNoTauriError(cause)) {
      // 浏览器预览模式下所有 IPC 都失败，这不是用户的错误
      console.warn(`[toast suppressed] ${title}`, cause);
      return;
    }
    if (cause !== undefined) console.error(`${title}:`, cause);
    useToastStore
      .getState()
      .push("error", title, cause === undefined ? undefined : errText(cause));
  },
  success(title: string, detail?: string) {
    useToastStore.getState().push("success", title, detail);
  },
  info(title: string, detail?: string) {
    useToastStore.getState().push("info", title, detail);
  },
};
