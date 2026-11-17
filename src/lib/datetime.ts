/** 消息时间格式化工具（统一聊天流的时间显示口径）。
 *  所有入参为 epoch 毫秒（与后端 `created_at` 一致）。 */

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 两个时间戳是否落在同一自然日（按本地时区）。 */
export function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** 计算 ts 相对今天的「自然日差」：0=今天，1=昨天，2=前天…… */
function dayDiff(ts: number): number {
  const d = new Date(ts);
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  return Math.round((startOfToday.getTime() - startOfDay.getTime()) / 86_400_000);
}

/** 气泡下方的小时间：仅 HH:MM。 */
export function formatMessageTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** 日期分隔条文案：今天 / 昨天 / 本周内的周X / 今年的 M月D日 / 跨年的 YYYY年M月D日。 */
export function formatDayDivider(ts: number): string {
  const diff = dayDiff(ts);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";

  const d = new Date(ts);
  // 最近一周内（含今天起 7 天内）用星期称呼，更口语
  if (diff > 1 && diff < 7) return WEEKDAYS[d.getDay()];

  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 完整日期时间，用于气泡 hover 的 title 提示：YYYY年M月D日 周X HH:MM。 */
export function formatFullDateTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]} ${hh}:${mm}`;
}

/** 会话列表右上角的时间：今天 HH:MM / 昨天 / 一周内周X / 今年 M/D / 更早 YYYY/M/D。 */
export function formatListTime(ts: number): string {
  const diff = dayDiff(ts);
  if (diff <= 0) return formatMessageTime(ts);
  if (diff === 1) return "昨天";
  const d = new Date(ts);
  if (diff < 7) return WEEKDAYS[d.getDay()];
  if (d.getFullYear() === new Date().getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** 消息流里两条消息隔了多久才插一条时间（同一天内）。 */
export const TIME_GAP_MS = 5 * 60_000;

// ─── 拍摄时间（ADR-053） ─────────────────────────────────────────────────────
// 显示拍摄地当时的钟面时间，不按现在所在的时区换算：东京晚上 8 点拍的，在哪儿看都是 20:00。

/** 拍摄地的钟面时间：把偏移加进去后按 UTC 读各字段。 */
function takenWall(at: number, offset: number): Date {
  return new Date(at + offset * 60_000);
}

/** 查看器里的拍摄时间：YYYY年M月D日 HH:MM。 */
export function formatTakenTime(at: number, offset: number): string {
  const d = takenWall(at, offset);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${hh}:${mm}`;
}

/** 时区：UTC+9 / UTC+5:30 / UTC-4 / UTC。 */
export function formatUtcOffset(offset: number): string {
  if (offset === 0) return "UTC";
  const sign = offset > 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const m = abs % 60;
  return `UTC${sign}${Math.floor(abs / 60)}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** 照片的时间（排序、按月分组用）：有拍摄时间用拍摄时间，否则用消息时间。 */
export function photoTime(m: { takenAt: number | null; createdAt: number }): number {
  return m.takenAt ?? m.createdAt;
}

/** 照片属于哪一年哪一月：拍摄地的日期；没有拍摄时间时按本地时区看消息时间。 */
export function photoYearMonth(m: {
  takenAt: number | null;
  takenOffset: number | null;
  createdAt: number;
}): [number, number] {
  if (m.takenAt != null) {
    const d = takenWall(m.takenAt, m.takenOffset ?? 0);
    return [d.getUTCFullYear(), d.getUTCMonth() + 1];
  }
  const d = new Date(m.createdAt);
  return [d.getFullYear(), d.getMonth() + 1];
}
