// Periods for the statistics page (ADR-056). Everything is in local calendar
// terms; the backend gets bucket edges twice: as wall-clock ms (local time
// written as UTC, matching how each view stored its own offset) and as real
// instants (for import times, which carry no offset).

export type PeriodKind = "day" | "week" | "month" | "year";

export interface Period {
  kind: PeriodKind;
  /** Local start: midnight of the day / Monday / 1st / 1 Jan. */
  y: number;
  m: number;
  d: number;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function startOf(kind: PeriodKind, date: Date): Period {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  switch (kind) {
    case "day":
      return { kind, y, m, d };
    case "week": {
      const back = (date.getDay() + 6) % 7; // Monday first
      const s = new Date(y, m, d - back);
      return { kind, y: s.getFullYear(), m: s.getMonth(), d: s.getDate() };
    }
    case "month":
      return { kind, y, m, d: 1 };
    case "year":
      return { kind, y, m: 0, d: 1 };
  }
}

export function currentPeriod(kind: PeriodKind, now = new Date()): Period {
  return startOf(kind, now);
}

/** The period of `kind` containing the start of `p` (switching day ↔ month…). */
export function switchKind(p: Period, kind: PeriodKind, now = new Date()): Period {
  // Coming from a longer period that holds today: land on today.
  const cur = currentPeriod(p.kind, now);
  if (samePeriod(p, cur)) return currentPeriod(kind, now);
  return startOf(kind, new Date(p.y, p.m, p.d));
}

export function shift(p: Period, by: number): Period {
  switch (p.kind) {
    case "day":
      return startOf("day", new Date(p.y, p.m, p.d + by));
    case "week":
      return startOf("week", new Date(p.y, p.m, p.d + 7 * by));
    case "month":
      return startOf("month", new Date(p.y, p.m + by, 1));
    case "year":
      return startOf("year", new Date(p.y + by, 0, 1));
  }
}

export function samePeriod(a: Period, b: Period): boolean {
  return a.kind === b.kind && a.y === b.y && a.m === b.m && a.d === b.d;
}

/** Bucket starts as local date parts; one more at the end closes the range. */
function bucketParts(p: Period): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  switch (p.kind) {
    case "day":
      for (let h = 0; h <= 24; h++) out.push([p.y, p.m, p.d, h]);
      break;
    case "week":
      for (let i = 0; i <= 7; i++) out.push([p.y, p.m, p.d + i, 0]);
      break;
    case "month": {
      const days = new Date(p.y, p.m + 1, 0).getDate();
      for (let i = 0; i <= days; i++) out.push([p.y, p.m, 1 + i, 0]);
      break;
    }
    case "year":
      for (let i = 0; i <= 12; i++) out.push([p.y, i, 1, 0]);
      break;
  }
  return out;
}

export function bucketEdges(p: Period): { edges: number[]; utcEdges: number[] } {
  const parts = bucketParts(p);
  return {
    edges: parts.map(([y, m, d, h]) => Date.UTC(y, m, d, h)),
    utcEdges: parts.map(([y, m, d, h]) => new Date(y, m, d, h).getTime()),
  };
}

/** How many days the period has had so far (for the daily average). */
export function elapsedDays(p: Period, now = new Date()): number {
  const { utcEdges } = bucketEdges(p);
  const start = utcEdges[0];
  const end = Math.min(utcEdges[utcEdges.length - 1], now.getTime());
  return Math.max(1, Math.ceil((end - start) / 86_400_000));
}

/** Title for the period: 今天 / 本周 / 2026年11月 … */
export function periodTitle(p: Period, now = new Date()): string {
  const thisYear = now.getFullYear();
  const ymd = (y: number, m: number, d: number) =>
    y === thisYear ? `${m + 1}月${d}日` : `${y}年${m + 1}月${d}日`;
  switch (p.kind) {
    case "day": {
      const cur = currentPeriod("day", now);
      if (samePeriod(p, cur)) return "今天";
      if (samePeriod(p, shift(cur, -1))) return "昨天";
      return `${ymd(p.y, p.m, p.d)} 周${WEEKDAYS[new Date(p.y, p.m, p.d).getDay()]}`;
    }
    case "week": {
      const cur = currentPeriod("week", now);
      if (samePeriod(p, cur)) return "本周";
      if (samePeriod(p, shift(cur, -1))) return "上周";
      const e = new Date(p.y, p.m, p.d + 6);
      const end = e.getMonth() === p.m ? `${e.getDate()}日` : `${e.getMonth() + 1}月${e.getDate()}日`;
      return `${ymd(p.y, p.m, p.d)}–${end}`;
    }
    case "month":
      return p.y === thisYear ? `${p.m + 1}月` : `${p.y}年${p.m + 1}月`;
    case "year":
      return `${p.y}年`;
  }
}

/** Label under bucket `i`, or "" where the axis stays quiet. */
export function bucketLabel(p: Period, i: number): string {
  switch (p.kind) {
    case "day":
      return i % 6 === 0 ? String(i) : "";
    case "week":
      return WEEKDAYS[(i + 1) % 7];
    case "month":
      return i % 7 === 0 ? String(i + 1) : "";
    case "year":
      return `${i + 1}月`;
  }
}

/** Full name of bucket `i`, for its tooltip. */
export function bucketName(p: Period, i: number): string {
  switch (p.kind) {
    case "day":
      return `${i}:00–${i + 1}:00`;
    case "week":
    case "month": {
      const d = new Date(p.y, p.m, p.d + i);
      return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAYS[d.getDay()]}`;
    }
    case "year":
      return `${p.y}年${i + 1}月`;
  }
}

/** The shorter period a bucket opens into (week/month → day, year → month). */
export function drillDown(p: Period, i: number): Period | null {
  switch (p.kind) {
    case "day":
      return null;
    case "week":
    case "month":
      return startOf("day", new Date(p.y, p.m, p.d + i));
    case "year":
      return startOf("month", new Date(p.y, i, 1));
  }
}

/** 3小时12分钟 · 12分钟 · 45秒 · 0分钟 */
export function formatWatch(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
  if (m > 0) return `${m}分钟`;
  if (s > 0) return `${s}秒`;
  return "0分钟";
}

/** Short axis label: 30分 · 1小时 · 1.5小时 */
export function formatAxis(ms: number): string {
  const min = ms / 60_000;
  if (min < 60) return `${Math.round(min)}分`;
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}小时`;
}

const NICE_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 720, 1440, 2880, 4320, 7200, 14400, 28800];

/** A round axis top at or above `ms`. */
export function niceMax(ms: number): number {
  const min = ms / 60_000;
  for (const n of NICE_MIN) if (min <= n) return n * 60_000;
  return Math.ceil(min / 28800) * 28800 * 60_000;
}

/** A view's start as the clock showed it where it was watched. */
export function formatViewTime(startedAt: number, tzOffset: number, now = new Date()): string {
  const d = new Date(startedAt + tzOffset * 60_000);
  const y = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const date = y === now.getFullYear() ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日` : `${y}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  return `${date} 周${WEEKDAYS[d.getUTCDay()]} ${hh}:${mm}`;
}

/** Shorter, for lists: 1小时27分 · 45分 · 30秒 */
export function formatWatchShort(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}小时${m}分` : `${h}小时`;
  if (m > 0) return `${m}分`;
  return `${s}秒`;
}

/** Number / unit pairs for a large display: [[3, "小时"], [11, "分钟"]]. */
export function watchParts(ms: number): [number, string][] {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const out: [number, string][] = [];
  if (h > 0) out.push([h, "小时"]);
  if (m > 0) out.push([m, "分钟"]);
  if (out.length === 0) out.push(s > 0 ? [s, "秒"] : [0, "分钟"]);
  return out;
}

/** Index of the bucket holding `now`, or null when the period isn't current. */
export function currentBucket(p: Period, now = new Date()): number | null {
  if (!samePeriod(p, currentPeriod(p.kind, now))) return null;
  switch (p.kind) {
    case "day":
      return now.getHours();
    case "week":
      return (now.getDay() + 6) % 7;
    case "month":
      return now.getDate() - 1;
    case "year":
      return now.getMonth();
  }
}

/** The real dates behind a relative title (今天 → 11月18日), or null. */
export function periodRange(p: Period, now = new Date()): string | null {
  const t = periodTitle(p, now);
  if (p.kind === "day" && (t === "今天" || t === "昨天")) return `${p.m + 1}月${p.d}日`;
  if (p.kind === "week" && (t === "本周" || t === "上周")) {
    const e = new Date(p.y, p.m, p.d + 6);
    const end = e.getMonth() === p.m ? `${e.getDate()}日` : `${e.getMonth() + 1}月${e.getDate()}日`;
    return `${p.m + 1}月${p.d}日–${end}`;
  }
  return null;
}
