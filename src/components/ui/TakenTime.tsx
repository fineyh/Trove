import { formatTakenTime, formatUtcOffset } from "../../lib/datetime";

interface TakenTimeProps {
  at: number | null;
  offset: number | null;
}

/** 查看器左上角的拍摄时间（ADR-053）。没有拍摄时间就什么都不显示。 */
export function TakenTime({ at, offset }: TakenTimeProps) {
  if (at == null) return null;
  const off = offset ?? 0;
  return (
    <div
      className="flex h-9 items-center px-1 text-sm tabular-nums text-white/70"
      data-tip={formatUtcOffset(off)}
      onClick={(e) => e.stopPropagation()}
    >
      {formatTakenTime(at, off)}
    </div>
  );
}
