import { Loader2, X } from "lucide-react";
import { useImportJobStore } from "../../stores/importJob";

interface ImportProgressBarProps {
  /** Only show the bar when the running job belongs to this conversation.
   *  Omit to show whichever import is running (e.g. while creating one). */
  convId?: number;
}

/** Progress strip for a running import. Imports run on a background thread,
 *  so this stays responsive — including its cancel button. */
export function ImportProgressBar({ convId }: ImportProgressBarProps) {
  const job = useImportJobStore((s) => s.job);
  const cancelling = useImportJobStore((s) => s.cancelling);
  const cancel = useImportJobStore((s) => s.cancel);

  if (!job) return null;
  if (convId !== undefined && job.convId !== convId) return null;

  // total 0 = backend still enumerating the folder.
  const counting = job.total === 0;
  const pct = counting
    ? 0
    : Math.min(100, Math.round((job.done / job.total) * 100));

  return (
    <div className="flex flex-col gap-1.5 border-t border-app-border bg-app-subtle/60 px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <Loader2 size={13} className="shrink-0 animate-spin text-app-accent" />
        <span className="shrink-0 text-app-fg/80">
          {counting ? "正在统计文件..." : `正在导入 ${job.done}/${job.total}`}
        </span>
        <span className="min-w-0 flex-1 truncate text-app-muted">
          {job.current ?? ""}
        </span>
        <button
          type="button"
          onClick={() => void cancel()}
          disabled={cancelling}
          title="取消导入"
          className="flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-app-muted hover:bg-app-subtle hover:text-app-fg disabled:opacity-50"
        >
          <X size={12} />
          {cancelling ? "正在停止" : "取消"}
        </button>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-app-border">
        <div
          className={
            counting
              ? "h-full w-1/3 animate-pulse rounded-full bg-app-accent"
              : "h-full rounded-full bg-app-accent transition-[width] duration-200"
          }
          style={counting ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
