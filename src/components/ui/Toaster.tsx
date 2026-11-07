import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { useToastStore, type ToastKind } from "../../stores/toast";

const ICON: Record<ToastKind, typeof AlertCircle> = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

/** Only the icon carries the color; the card stays neutral. */
const TONE: Record<ToastKind, string> = {
  error: "text-app-danger",
  success: "text-app-success",
  info: "text-app-accent",
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const pause = useToastStore((s) => s.pause);
  const resume = useToastStore((s) => s.resume);

  if (toasts.length === 0) return null;

  return (
    // z 要压过 Lightbox / 各类对话框（z-50）和地图的 Leaflet 面板（z-[1000]）。
    // 容器 pointer-events-none，只有卡片本体可点，不挡住下面的界面。
    // 放在 52px 标题行下面，不压住右上角的窗口按钮。
    <div
      className="pointer-events-none fixed right-4 top-[60px] z-[2000] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2"
      onMouseEnter={pause}
      onMouseLeave={resume}
    >
      {toasts.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex animate-pop-in items-start gap-2.5 rounded-xl bg-app-panel py-2.5 pl-3 pr-2 shadow-lg ring-1 ring-black/[0.06] dark:ring-white/10",
            )}
          >
            <Icon size={16} className={cn("mt-0.5 shrink-0", TONE[t.kind])} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-1.5 text-sm font-medium text-app-fg">
                <span className="truncate">{t.title}</span>
                {t.count > 1 && (
                  <span className="shrink-0 rounded bg-app-subtle px-1.5 text-2xs font-normal text-app-muted">
                    ×{t.count}
                  </span>
                )}
              </div>
              {t.detail && (
                // 技术细节可能很长（路径、SQL 报错），最多三行，可选中复制
                <div className="selectable line-clamp-3 break-words text-xs text-app-muted">
                  {t.detail}
                </div>
              )}
            </div>
            <button
              type="button"
              aria-label="关闭"
              onClick={() => dismiss(t.id)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-app-muted transition-colors duration-fast hover:bg-app-hover/5 hover:text-app-fg"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
