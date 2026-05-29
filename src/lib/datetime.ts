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
