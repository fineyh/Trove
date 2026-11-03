import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { useToastStore, type ToastKind } from "../../stores/toast";

const ICON: Record<ToastKind, typeof AlertCircle> = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

/** 和 AboutPane / BackupPane 的内联提示条用同一套语义色。 */
const TONE: Record<ToastKind, string> = {
  error: "border-red-500/30 text-red-500",
  success: "border-emerald-500/30 text-emerald-600",
  info: "border-app-border text-app-accent",
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
    <div
      className="pointer-events-none fixed right-3 top-3 z-[2000] flex w-[22rem] max-w-[calc(100vw-1.5rem)] flex-col gap-2"
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
              "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-app-panel px-3 py-2.5 shadow-lg",
              TONE[t.kind],
            )}
          >
            <Icon size={16} className="mt-0.5 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-1.5 text-sm font-medium text-app-fg">
                <span className="truncate">{t.title}</span>
                {t.count > 1 && (
                  <span className="shrink-0 rounded bg-app-subtle px-1.5 py-px text-[11px] font-normal text-app-muted">
                    ×{t.count}
                  </span>
                )}
              </div>
              {t.detail && (
                // 技术细节可能很长（路径、SQL 报错），最多三行，可选中复制
                <div className="line-clamp-3 select-text break-words text-xs text-app-muted">
                  {t.detail}
                </div>
              )}
            </div>
            <button
              type="button"
              title="关闭"
              aria-label="关闭提示"
              onClick={() => dismiss(t.id)}
              className="-mr-1 -mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-app-muted hover:bg-app-subtle hover:text-app-fg"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
