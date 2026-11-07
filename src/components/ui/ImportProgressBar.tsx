import { X } from "lucide-react";
import { useImportJobStore } from "../../stores/importJob";
import { useLibrariesStore } from "../../stores/libraries";
import { IconButton } from "./Button";

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
  const lib = useLibrariesStore((s) => s.current);

  if (!job) return null;
  // Conversation ids are per library: match both.
  if (convId !== undefined && (job.convId !== convId || job.lib !== lib)) return null;

  // total 0 = backend still enumerating the folder.
  const counting = job.total === 0;
  const pct = counting ? 0 : Math.min(100, Math.round((job.done / job.total) * 100));

  return (
    <div className="flex items-center gap-3 border-t border-app-border px-5 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="shrink-0 font-medium">
            {cancelling ? "正在停止" : counting ? "正在查找文件" : `正在导入 ${job.done.toLocaleString()} / ${job.total.toLocaleString()}`}
          </span>
          <span className="min-w-0 flex-1 truncate text-app-muted">{job.current ?? ""}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-app-subtle">
          <div
            className={
              counting
                ? "h-full w-1/3 animate-pulse rounded-full bg-app-accent"
                : "h-full rounded-full bg-app-accent transition-[width] duration-slow"
            }
            style={counting ? undefined : { width: `${pct}%` }}
          />
        </div>
      </div>
      <IconButton label="停止导入" size="sm" icon={<X size={14} />} onClick={() => void cancel()} disabled={cancelling} />
    </div>
  );
}
