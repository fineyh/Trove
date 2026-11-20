import { useEffect, useState } from "react";
import { statsItemHistory } from "../../ipc/client";
import { formatViewTime, formatWatch } from "../../lib/statsPeriod";
import { messageTitle } from "../../lib/media";
import type { ItemHistory, Message } from "../../types";
import { Modal } from "../ui/Modal";

const SURFACE: Record<string, string> = { popup: "新窗口", map: "地图" };

/** One image or video's viewing history (message right-click → 观看记录). */
export function ViewHistoryDialog({
  lib,
  message,
  onClose,
}: {
  lib: string;
  message: Message | null;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<ItemHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const id = message?.id ?? null;

  useEffect(() => {
    setHistory(null);
    setFailed(false);
    if (id === null) return;
    let cancelled = false;
    statsItemHistory(lib, id)
      .then((h) => !cancelled && setHistory(h))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [lib, id]);

  const isVideo = message?.media?.kind === "video" || message?.media?.kind === "audio";
  const last = history?.views[0];

  return (
    <Modal open={message !== null} onClose={onClose} title="观看记录" subtitle={message ? messageTitle(message) : undefined} width="sm" layer="top">
      {failed ? (
        <p className="py-6 text-center text-sm text-app-muted">无法读取观看记录</p>
      ) : !history ? (
        <div className="h-24" />
      ) : history.viewCount === 0 ? (
        <p className="py-6 text-center text-sm text-app-muted">没有观看记录</p>
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-3 gap-2">
            <Fact label="时长" value={formatWatch(history.totalMs)} />
            <Fact label={isVideo ? "播放" : "查看"} value={`${history.plays} 次`} />
            <Fact label="最近" value={last ? formatViewTime(last.startedAt, last.tzOffset).split(" ")[0] : "—"} />
          </dl>
          <ul className="-mx-1 flex flex-col">
            {history.views.map((v, i) => (
              <li key={i} className="flex items-baseline gap-2 rounded-md px-1 py-1 text-sm">
                <span className="tabular-nums">{formatViewTime(v.startedAt, v.tzOffset)}</span>
                {SURFACE[v.surface] && <span className="text-xs text-app-muted">{SURFACE[v.surface]}</span>}
                <span className="flex-1" />
                <span className="text-xs tabular-nums text-app-secondary">{formatWatch(v.watchMs)}</span>
              </li>
            ))}
          </ul>
          {history.viewCount > history.views.length && (
            <p className="text-xs text-app-muted">仅显示最近 {history.views.length} 次</p>
          )}
        </div>
      )}
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-app-subtle px-3 py-2">
      <dt className="text-2xs text-app-muted">{label}</dt>
      <dd className="truncate text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}
