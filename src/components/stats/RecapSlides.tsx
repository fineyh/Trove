// The pages of the month / year recap (ADR-057). Every page has the same
// bones: a quiet label, one large figure, a few facts under it, and the
// picture of it on the right. Layout and type scale live here; the stage,
// paging and keys are in RecapView.

import { ArrowRight, FileText, Film, Image as ImageIcon, Play, RotateCcw, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatBytes } from "../../lib/media";
import {
  bucketName,
  currentBucket,
  currentPeriod,
  dayOf,
  elapsedDays,
  formatDay,
  formatWatch,
  formatWatchShort,
  niceMax,
  samePeriod,
  shift,
  watchParts,
  type Period,
} from "../../lib/statsPeriod";
import { useConversationsStore } from "../../stores/conversations";
import { useLibrariesStore } from "../../stores/libraries";
import { useSettingsStore } from "../../stores/settings";
import { useThumbUrl } from "../../stores/thumbs";
import type { Recap, RecapCover, StatsOverview, StatsTopConv, StatsTopItem } from "../../types";
import { ConvAvatar } from "../ui/ConvAvatar";
import { RecapMap } from "./RecapMap";
import type { Nav } from "./RecapView";

export interface RecapData {
  lib: string;
  period: Period;
  o: StatsOverview;
  /** Watch time of the period before, for the comparison. */
  previousMs: number;
  r: Recap;
}

// ─── Bones ──────────────────────────────────────────────────────────────────

/** Entrance: rises into place, staggered by `i`. */
function Rise({ i = 0, className, children }: { i?: number; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("recap-rise", className)} style={{ "--i": i } as React.CSSProperties}>
      {children}
    </div>
  );
}

/** Words on the left, the picture on the right. */
function Split({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="grid w-full grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-center gap-14">
      <div className="flex min-w-0 flex-col gap-7">{left}</div>
      <div className="flex min-w-0 items-center justify-center">{right}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-medium text-app-secondary">{children}</p>;
}

const BIG = "text-[clamp(52px,6.4vw,92px)] font-semibold leading-[0.9] tracking-[-0.035em] tabular-nums";

function Big({ parts }: { parts: [number | string, string][] }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {parts.map(([n, unit]) => (
        <span key={unit} className="flex items-baseline gap-1.5">
          <span className={BIG}>{typeof n === "number" ? n.toLocaleString() : n}</span>
          {unit && <span className="text-xl font-medium text-app-secondary">{unit}</span>}
        </span>
      ))}
    </p>
  );
}

function Facts({ items }: { items: [string, string][] }) {
  return (
    <div className="grid grid-cols-3 gap-x-6 gap-y-5">
      {items.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-[clamp(16px,1.6vw,20px)] font-semibold tabular-nums">{value}</span>
          <span className="truncate text-xs text-app-muted">{label}</span>
        </div>
      ))}
    </div>
  );
}

function Thumb({ lib, cover, className }: { lib: string; cover: RecapCover; className?: string }) {
  const src = useThumbUrl(lib, { id: cover.mediaId, hasThumb: true });
  return (
    <span className={cn("relative block overflow-hidden bg-app-subtle", className)}>
      {src && <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />}
      {cover.kind === "video" && (
        <span className="absolute bottom-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
          <Play size={10} fill="currentColor" />
        </span>
      )}
    </span>
  );
}

const PILL = "inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-medium transition-colors duration-fast";

/** Today's index in a day grid, or null when the period is over. */
function todayIndex(p: Period, now = new Date()): number | null {
  if (!samePeriod(p, currentPeriod(p.kind, now))) return null;
  return Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(p.y, p.m, p.d)) / 86_400_000);
}

const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);

// ─── Cover ──────────────────────────────────────────────────────────────────

export function CoverSlide({ d, empty, nav }: { d: RecapData; empty: boolean; nav: Nav }) {
  const space = useLibrariesStore((s) => s.list.find((l) => l.id === d.lib)?.name);
  const p = d.period;
  const today = todayIndex(p);
  const covers = empty ? [] : d.r.covers;
  const words = (
    <>
      <Rise i={0}>
        <Label>{space}</Label>
      </Rise>
      <Rise i={1} className="flex flex-col gap-4">
        <p className="text-[clamp(64px,8.4vw,120px)] font-semibold leading-[0.85] tracking-[-0.045em] tabular-nums">
          {p.kind === "year" ? p.y : `${p.m + 1}月`}
        </p>
        <p className="text-2xl font-medium tracking-tight text-app-fg/90">
          {p.kind === "year" ? "年度回顾" : `${p.y}年 · 月度回顾`}
        </p>
      </Rise>
      <Rise i={2} className="flex flex-col items-start gap-6">
        {today !== null && <p className="text-sm text-app-muted">截至 {formatDay(dayOf(p, today))}</p>}
        {empty ? (
          <p className="text-sm text-app-secondary">没有记录</p>
        ) : (
          <button type="button" onClick={nav.next} className={cn(PILL, "bg-app-fg text-app hover:bg-app-fg/85")}>
            开始
            <ArrowRight size={16} />
          </button>
        )}
      </Rise>
    </>
  );
  if (covers.length === 0) {
    return <div className="flex w-full max-w-[560px] flex-col gap-7">{words}</div>;
  }
  return <Split left={words} right={<Mosaic lib={d.lib} covers={covers} />} />;
}

/** The period's pictures as a loose wall: columns nudged up and down. */
function Mosaic({ lib, covers }: { lib: string; covers: RecapCover[] }) {
  const n = covers.length;
  const cols = n >= 9 ? 4 : n >= 4 ? 3 : n;
  const rows = Math.min(3, Math.max(1, Math.floor(n / cols)));
  const shown = covers.slice(0, cols * rows);
  const NUDGE = [0, 36, 12, 48];
  return (
    <div
      className="flex w-full max-w-[560px] gap-3 overflow-hidden"
      style={{
        maxHeight: "min(600px, calc(100vh - 190px))",
        maskImage: "linear-gradient(to bottom, black 82%, transparent)",
      }}
    >
      {Array.from({ length: cols }, (_, c) => (
        <div key={c} className="flex min-w-0 flex-1 flex-col gap-3" style={{ paddingTop: NUDGE[c] }}>
          {shown
            .filter((_, i) => i % cols === c)
            .map((cover, r) => (
              <Rise key={cover.mediaId} i={2 + c + r}>
                <Thumb lib={lib} cover={cover} className="aspect-[4/5] w-full rounded-xl ring-1 ring-app-hover/10" />
              </Rise>
            ))}
        </div>
      ))}
    </div>
  );
}

// ─── Added ──────────────────────────────────────────────────────────────────

export function AddedSlide({ d }: { d: RecapData }) {
  const { o, r, period } = d;
  const t = o.added.reduce(
    (a, b) => ({ image: a.image + b.image, video: a.video + b.video, other: a.other + b.other }),
    { image: 0, video: 0, other: 0 },
  );
  const total = t.image + t.video + t.other;
  const values = o.added.map((a) => a.image + a.video + a.other);
  return (
    <Split
      left={
        <>
          <Rise i={0}>
            <Label>新增</Label>
          </Rise>
          <Rise i={1}>
            <Big parts={[[total, "项"]]} />
          </Rise>
          <Rise i={2} className="flex flex-wrap gap-2">
            <Chip icon={<ImageIcon size={14} />} label="图片" n={t.image} />
            <Chip icon={<Film size={14} />} label="视频" n={t.video} />
            {t.other > 0 && <Chip icon={<FileText size={14} />} label="文件" n={t.other} />}
          </Rise>
          <Rise i={3}>
            <Facts
              items={[
                ["大小", formatBytes(r.addedBytes)],
                ["新会话", r.newConvs.toLocaleString()],
                ["现在共", `${(o.itemsBefore + total).toLocaleString()} 项`],
              ]}
            />
          </Rise>
        </>
      }
      right={
        <Rise i={2} className="w-full">
          <Columns
            period={period}
            values={values}
            tip={(i) => {
              const a = o.added[i];
              const parts = [a.image ? `图片 ${a.image}` : "", a.video ? `视频 ${a.video}` : "", a.other ? `文件 ${a.other}` : ""].filter(Boolean);
              return `${bucketName(period, i)}\n${parts.length ? parts.join(" · ") : "无"}`;
            }}
            peakLabel={(v) => `${v.toLocaleString()} 项`}
          />
        </Rise>
      }
    />
  );
}

function Chip({ icon, label, n }: { icon: React.ReactNode; label: string; n: number }) {
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-full bg-app-hover/[0.07] pl-2.5 pr-3 text-sm">
      <span className="text-app-accent">{icon}</span>
      <span className="text-app-secondary">{label}</span>
      <span className="font-medium tabular-nums">{n.toLocaleString()}</span>
    </span>
  );
}

/** Axis labels for a month (1, 8, 15…) or a year (1月…12月). */
function axisLabel(p: Period, i: number): string {
  if (p.kind === "year") return `${i + 1}月`;
  return i % 7 === 0 ? String(i + 1) : "";
}

/** One column per bucket, the highest one in the accent with its value on top. */
function Columns({
  period,
  values,
  split,
  tip,
  peakLabel,
}: {
  period: Period;
  values: number[];
  /** Share of each column drawn solid (the rest lighter), for video / image. */
  split?: number[];
  tip: (i: number) => string;
  peakLabel: (v: number) => string;
}) {
  const height = 232;
  const now = currentBucket(period);
  const peak = values.reduce((b, v, i) => (v > values[b] ? i : b), 0);
  const top = Math.max(...values, 0);
  const max = split ? niceMax(top) : top * 1.12;
  const dense = values.length > 12;
  return (
    <div className="flex w-full flex-col">
      <div className={cn("relative flex items-end", dense ? "gap-[3px]" : "gap-2.5")} style={{ height }}>
        <span className="absolute inset-x-0 bottom-0 border-t border-app-hover/15" />
        {values.map((v, i) => {
          const future = now !== null && i > now;
          const h = max > 0 ? (v / max) * 100 : 0;
          const isPeak = i === peak && v > 0;
          return (
            <div
              key={i}
              data-tip={future ? undefined : tip(i)}
              data-tip-side="top"
              className="group relative flex h-full min-w-0 flex-1 items-end justify-center"
            >
              {isPeak && (
                <span
                  className="absolute left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap pb-2 text-xs font-medium tabular-nums text-app-fg"
                  style={{ bottom: `${h}%` }}
                >
                  {peakLabel(v)}
                </span>
              )}
              <span
                className={cn(
                  "recap-grow flex w-full max-w-9 flex-col-reverse overflow-hidden transition-[filter] duration-fast group-hover:brightness-125",
                  dense ? "rounded-t-[3px]" : "rounded-t-md",
                )}
                style={{ height: `${h}%`, minHeight: v > 0 ? 3 : 0, "--i": i } as React.CSSProperties}
              >
                {split ? (
                  <>
                    <span className="w-full bg-app-accent" style={{ height: `${split[i] * 100}%` }} />
                    <span className="w-full flex-1 bg-app-accent/40" />
                  </>
                ) : (
                  <span className={cn("h-full w-full", isPeak ? "bg-app-accent" : "bg-app-fg/20")} />
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className={cn("mt-2.5 flex", dense ? "gap-[3px]" : "gap-2.5")}>
        {values.map((_, i) => (
          <span
            key={i}
            className={cn(
              "min-w-0 flex-1 overflow-visible whitespace-nowrap text-2xs tabular-nums",
              dense ? "text-left" : "text-center",
              i === now ? "font-semibold text-app-accent" : "text-app-muted",
              now !== null && i > now && "opacity-50",
            )}
          >
            {axisLabel(period, i)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Taken ──────────────────────────────────────────────────────────────────

export function TakenSlide({ d }: { d: RecapData }) {
  const { r, period, lib } = d;
  const total = sum(r.taken);
  const activeDays = r.taken.filter((n) => n > 0).length;
  const busiest = r.busiest;
  const head = (
    <>
      <Rise i={0}>
        <Label>拍摄</Label>
      </Rise>
      <Rise i={1}>
        <Big parts={[[total, "项"]]} />
      </Rise>
      <Rise i={2}>
        <Facts
          items={[
            ["有拍摄的天数", `${activeDays} 天`],
            ["最长连续", `${longestRun(r.taken)} 天`],
            ["日均", (total / ((todayIndex(period) ?? r.taken.length - 1) + 1)).toFixed(1)],
          ]}
        />
      </Rise>
    </>
  );
  const day = busiest && (
    <Rise i={3} className="flex flex-col gap-3">
      <p className="flex items-baseline gap-2 text-sm">
        <span className="text-app-muted">最多的一天</span>
        <span>{formatDay(dayOf(period, busiest.day))}</span>
        <span className="tabular-nums text-app-secondary">{busiest.count} 项</span>
      </p>
      {busiest.covers.length > 0 && (
        <div className="grid max-w-[360px] grid-cols-6 gap-2">
          {busiest.covers.map((c) => (
            <Thumb key={c.mediaId} lib={lib} cover={c} className="aspect-square w-full rounded-lg" />
          ))}
        </div>
      )}
    </Rise>
  );

  if (period.kind === "month") {
    return (
      <Split
        left={
          <>
            {head}
            {day}
          </>
        }
        right={
          <Rise i={2} className="w-full max-w-[min(460px,calc((100vh-230px)*7/6.6))]">
            <Calendar d={d} />
          </Rise>
        }
      />
    );
  }
  // A year of days needs the full width to be readable.
  return (
    <div className="flex w-full flex-col gap-10">
      <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-end gap-14">
        <div className="flex min-w-0 flex-col gap-7">{head}</div>
        <div className="flex min-w-0 justify-end">{day}</div>
      </div>
      <Rise i={4}>
        <YearGrid d={d} />
      </Rise>
    </div>
  );
}

/** Most days in a row with anything taken. */
function longestRun(days: number[]): number {
  let best = 0;
  let run = 0;
  for (const n of days) {
    run = n > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

const WEEK_HEAD = ["一", "二", "三", "四", "五", "六", "日"];

/** Four steps of the accent by quartile of the days that have any. */
function levels(values: number[]): (v: number) => number {
  const nz = values.filter((v) => v > 0).sort((a, b) => a - b);
  const q = (f: number) => nz[Math.min(nz.length - 1, Math.floor(f * nz.length))] ?? 0;
  const [a, b, c] = [q(0.25), q(0.5), q(0.75)];
  return (v) => (v <= 0 ? 0 : v <= a ? 1 : v <= b ? 2 : v <= c ? 3 : 4);
}
const LEVEL_BG = ["bg-app-hover/[0.06]", "bg-app-accent/30", "bg-app-accent/55", "bg-app-accent/80", "bg-app-accent"];

function YearGrid({ d }: { d: RecapData }) {
  const { r, period } = d;
  const lead = (dayOf(period, 0).getDay() + 6) % 7;
  const cols = Math.ceil((lead + r.taken.length) / 7);
  const level = levels(r.taken);
  const today = todayIndex(period);
  const monthStarts = Array.from({ length: 12 }, (_, m) => {
    const i = Math.round((Date.UTC(period.y, m, 1) - Date.UTC(period.y, 0, 1)) / 86_400_000);
    return { m, col: Math.floor((lead + i) / 7) };
  });
  return (
    <div className="flex w-full gap-2.5">
      <div className="grid w-4 shrink-0 grid-rows-[16px_repeat(7,minmax(0,1fr))] gap-[3px] text-2xs text-app-muted">
        <span />
        {WEEK_HEAD.map((w, i) => (
          <span key={w} className="flex items-center leading-none">
            {i % 2 === 0 ? w : ""}
          </span>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="relative h-4 text-2xs text-app-muted">
          {monthStarts.map(({ m, col }) => (
            <span key={m} className="absolute top-0" style={{ left: `${(col / cols) * 100}%` }}>
              {m + 1}月
            </span>
          ))}
        </div>
        <div
          className="grid gap-[3px]"
          style={{ gridTemplateRows: "repeat(7, minmax(0, 1fr))", gridAutoFlow: "column", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: lead }, (_, i) => (
            <span key={`lead${i}`} />
          ))}
          {r.taken.map((n, i) => {
            const future = today !== null && i > today;
            return (
              <span
                key={i}
                data-tip={future ? undefined : `${formatDay(dayOf(period, i))}\n${n > 0 ? `${n} 项` : "无"}`}
                data-tip-side="top"
                className={cn(
                  "aspect-square w-full rounded-[3px] transition-[filter] duration-fast hover:brightness-150",
                  future ? "bg-app-hover/[0.025]" : LEVEL_BG[level(n)],
                  i === today && "ring-1 ring-app-fg/60",
                )}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A month as a calendar of its days' pictures. */
function Calendar({ d }: { d: RecapData }) {
  const { r, period, lib } = d;
  const lead = (dayOf(period, 0).getDay() + 6) % 7;
  const today = todayIndex(period);
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="grid grid-cols-7 gap-1.5 text-center text-2xs text-app-muted">
        {WEEK_HEAD.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead${i}`} />
        ))}
        {r.taken.map((n, i) => {
          const cover = r.dayCovers[i];
          const future = today !== null && i > today;
          return (
            <Rise
              key={i}
              i={Math.min(10, Math.floor((lead + i) / 7) + 2)}
              className={cn(
                "relative aspect-square overflow-hidden rounded-lg",
                i === today && "ring-2 ring-app-fg/70 ring-offset-2 ring-offset-app",
              )}
            >
              {/* Fill and fade inside: the entrance animation owns the cell's own opacity. */}
              <span
                data-tip={future ? undefined : `${formatDay(dayOf(period, i))}\n${n > 0 ? `${n} 项` : "无"}`}
                data-tip-side="top"
                className={cn(
                  "absolute inset-0",
                  cover ? "" : n > 0 ? "bg-app-accent/25" : "bg-app-hover/[0.05]",
                  future && "opacity-35",
                )}
              >
                {cover && <Thumb lib={lib} cover={cover} className="h-full w-full" />}
                <span
                  className={cn(
                    "absolute left-1.5 top-1 text-2xs font-semibold tabular-nums",
                    cover ? "text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.6)]" : n > 0 ? "text-app-fg" : "text-app-muted",
                  )}
                >
                  {i + 1}
                </span>
              </span>
            </Rise>
          );
        })}
      </div>
    </div>
  );
}

// ─── Places ─────────────────────────────────────────────────────────────────

export function PlacesSlide({ d }: { d: RecapData }) {
  const { r, lib } = d;
  const mapOn = useSettingsStore((s) => s.settings.mapTiles === "online");
  return (
    <Split
      left={
        <>
          <Rise i={0}>
            <Label>足迹</Label>
          </Rise>
          <Rise i={1}>
            <Big parts={[[r.placeCount, "个地方"]]} />
          </Rise>
          <Rise i={2}>
            <Facts
              items={[
                ["带位置", `${r.geoCount.toLocaleString()} 项`],
                ["最多一处", `${(r.places[0]?.count ?? 0).toLocaleString()} 项`],
              ]}
            />
          </Rise>
        </>
      }
      right={
        mapOn ? (
          <Rise i={2} className="w-full">
            <RecapMap lib={lib} places={r.places} />
          </Rise>
        ) : (
          <PlaceWall lib={lib} places={r.places} />
        )
      }
    />
  );
}

/** Without the map: the places' pictures, biggest first. */
function PlaceWall({ lib, places }: { lib: string; places: Recap["places"] }) {
  const shown = places.filter((p) => p.cover).slice(0, 8);
  return (
    <div className="grid w-full max-w-[520px] grid-cols-4 gap-3">
      {shown.map((p, i) => (
        <Rise key={i} i={2 + i} className="relative">
          <Thumb lib={lib} cover={p.cover!} className="aspect-square w-full rounded-xl" />
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-app-fg px-1.5 text-2xs font-semibold tabular-nums text-app">
            {p.count}
          </span>
        </Rise>
      ))}
    </div>
  );
}

// ─── Watching ───────────────────────────────────────────────────────────────

const AGAINST: Record<Period["kind"], string> = { day: "前一天", week: "前一周", month: "上个月", year: "去年" };

export function WatchSlide({ d }: { d: RecapData }) {
  const { o, period, previousMs } = d;
  const days = elapsedDays(period);
  const nowAvg = o.totalMs / days;
  const prevAvg = previousMs / elapsedDays(shift(period, -1));
  const pct = prevAvg > 0 && nowAvg > 0 ? Math.round(((nowAvg - prevAvg) / prevAvg) * 100) : null;
  const Trend = pct !== null && pct < 0 ? TrendingDown : TrendingUp;
  const values = o.buckets.map((b) => b.totalMs);
  const split = o.buckets.map((b) => {
    const k = b.videoMs + b.imageMs;
    return k > 0 ? b.videoMs / k : 1;
  });
  const videoMs = sum(o.buckets.map((b) => b.videoMs));
  const imageMs = sum(o.buckets.map((b) => b.imageMs));
  return (
    <Split
      left={
        <>
          <Rise i={0}>
            <Label>观看</Label>
          </Rise>
          <Rise i={1}>
            <Big parts={watchParts(o.totalMs)} />
          </Rise>
          {pct !== null && (
            <Rise i={2}>
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-app-hover/[0.07] px-3 text-xs text-app-secondary">
                <Trend size={14} className="text-app-accent" />
                {pct === 0 ? `日均与${AGAINST[period.kind]}持平` : `日均比${AGAINST[period.kind]}${pct > 0 ? "多" : "少"} ${Math.abs(pct)}%`}
              </span>
            </Rise>
          )}
          <Rise i={3}>
            <Facts
              items={[
                ["日均", formatWatchShort(nowAvg)],
                ["次数", o.plays.toLocaleString()],
                ["视频占", `${Math.round((videoMs / Math.max(1, videoMs + imageMs)) * 100)}%`],
              ]}
            />
          </Rise>
        </>
      }
      right={
        <Rise i={2} className="flex w-full flex-col gap-4">
          <Columns
            period={period}
            values={values}
            split={split}
            tip={(i) => {
              const b = o.buckets[i];
              return [bucketName(period, i), formatWatch(b.totalMs), b.videoMs > 0 && b.imageMs > 0 ? `视频 ${formatWatch(b.videoMs)} · 图片 ${formatWatch(b.imageMs)}` : ""]
                .filter(Boolean)
                .join("\n");
            }}
            peakLabel={formatWatchShort}
          />
          <div className="flex items-center gap-5 text-xs text-app-secondary">
            <Legend swatch="bg-app-accent" label="视频" />
            <Legend swatch="bg-app-accent/40" label="图片" />
          </div>
        </Rise>
      }
    />
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-[3px]", swatch)} />
      {label}
    </span>
  );
}

/** What part of the day an hour belongs to. */
function partOfDay(h: number): string {
  if (h < 5) return "深夜";
  if (h < 8) return "清晨";
  if (h < 12) return "上午";
  if (h < 14) return "中午";
  if (h < 18) return "下午";
  if (h < 23) return "晚上";
  return "深夜";
}

export function HoursSlide({ d }: { d: RecapData }) {
  const hours = d.o.hours;
  const peak = hours.reduce((b, v, h) => (v > hours[b] ? h : b), 0);
  // The three hours around the peak, as a share of the whole day.
  const around = hours[(peak + 23) % 24] + hours[peak] + hours[(peak + 1) % 24];
  return (
    <Split
      left={
        <>
          <Rise i={0}>
            <Label>最常在</Label>
          </Rise>
          <Rise i={1} className="flex items-end gap-4">
            <Big parts={[[peak, "点"]]} />
            <span className="mb-1 inline-flex h-7 items-center rounded-full bg-app-accent/15 px-3 text-sm font-medium text-app-accent">
              {partOfDay(peak)}
            </span>
          </Rise>
          <Rise i={2}>
            <Facts
              items={[
                [`${peak}:00–${peak + 1}:00`, formatWatchShort(hours[peak])],
                ["前后三小时占", `${Math.round((around / Math.max(1, sum(hours))) * 100)}%`],
              ]}
            />
          </Rise>
        </>
      }
      right={
        <Rise i={2}>
          <Clock hours={hours} peak={peak} />
        </Rise>
      }
    />
  );
}

/** The 24 hours round a dial, each a ray as long as its share. */
function Clock({ hours, peak }: { hours: number[]; peak: number }) {
  const S = 360;
  const c = S / 2;
  const r0 = 84;
  const len = 72;
  const max = Math.max(...hours, 1);
  const at = (h: number, r: number): [number, number] => {
    const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
    return [c + Math.cos(a) * r, c + Math.sin(a) * r];
  };
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="h-[min(380px,calc(100vh-230px))] w-auto max-w-full overflow-visible">
      <circle cx={c} cy={c} r={r0 - 14} fill="rgb(var(--hover) / 0.04)" />
      {hours.map((v, h) => {
        const [x1, y1] = at(h + 0.5, r0);
        const [x2, y2] = at(h + 0.5, r0 + 4 + (v / max) * len);
        return (
          <line
            key={h}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            strokeWidth={9}
            strokeLinecap="round"
            stroke={h === peak ? "rgb(var(--accent))" : "rgb(var(--fg) / 0.22)"}
          >
            <title>{`${h}:00–${h + 1}:00  ${formatWatch(v)}`}</title>
          </line>
        );
      })}
      {[0, 6, 12, 18].map((h) => {
        const [x, y] = at(h, r0 + len + 20);
        return (
          <text key={h} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="11" fill="rgb(var(--fg-3))" className="tabular-nums">
            {h}
          </text>
        );
      })}
      <text x={c} y={c - 8} textAnchor="middle" fontSize="12" fill="rgb(var(--fg-2))">
        {partOfDay(peak)}
      </text>
      <text x={c} y={c + 14} textAnchor="middle" fontSize="18" fontWeight="600" fill="rgb(var(--fg))" className="tabular-nums">
        {`${peak}:00`}
      </text>
    </svg>
  );
}

// ─── Most viewed, conversations ─────────────────────────────────────────────

export function TopItemsSlide({ d }: { d: RecapData }) {
  const [first, ...rest] = d.o.topItems;
  return (
    <Split
      left={
        <>
          <Rise i={0}>
            <Label>最常看</Label>
          </Rise>
          <Rise i={1} className="flex flex-col gap-4">
            <TopThumb lib={d.lib} item={first} className="aspect-[4/3] w-full max-w-[400px] rounded-2xl ring-1 ring-app-hover/10" />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="truncate text-xl font-semibold">{first.name}</p>
              <p className="truncate text-sm text-app-secondary">
                {first.convName} · {formatWatchShort(first.watchMs)}
                {first.plays > 0 && ` · ${first.plays} 次`}
              </p>
            </div>
          </Rise>
        </>
      }
      right={
        rest.length > 0 && (
          <div role="list" className="flex w-full flex-col gap-1">
            {rest.map((item, i) => (
              <Rise key={item.messageId} i={2 + i}>
                <div role="listitem" className="flex h-16 items-center gap-4">
                  <span className="w-4 shrink-0 text-sm tabular-nums text-app-muted">{i + 2}</span>
                  <TopThumb lib={d.lib} item={item} className="h-12 w-12 shrink-0 rounded-lg" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm">{item.name}</span>
                    <span className="truncate text-xs text-app-muted">{item.convName}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="text-sm tabular-nums">{formatWatchShort(item.watchMs)}</span>
                    <span className="text-xs tabular-nums text-app-muted">{item.plays > 0 ? `${item.plays} 次` : " "}</span>
                  </span>
                </div>
              </Rise>
            ))}
          </div>
        )
      }
    />
  );
}

function TopThumb({ lib, item, className }: { lib: string; item: StatsTopItem; className?: string }) {
  const src = useThumbUrl(lib, item.mediaId === null ? null : { id: item.mediaId, hasThumb: item.hasThumb });
  return (
    <span className={cn("relative flex items-center justify-center overflow-hidden bg-app-subtle text-app-muted", className)}>
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
      ) : item.kind === "video" ? (
        <Film size={20} />
      ) : (
        <ImageIcon size={20} />
      )}
    </span>
  );
}

export function ConvsSlide({ d }: { d: RecapData }) {
  const [first, ...rest] = d.o.topConvs;
  const max = first.watchMs;
  return (
    <Split
      left={
        <>
          <Rise i={0}>
            <Label>看得最多的会话</Label>
          </Rise>
          <Rise i={1} className="flex flex-col gap-5">
            <Avatar conv={first} size={88} />
            <div className="flex min-w-0 flex-col gap-2">
              <p className="truncate text-[clamp(28px,3.4vw,40px)] font-semibold leading-tight tracking-tight">{first.name}</p>
              <p className="text-sm text-app-secondary">
                {formatWatch(first.watchMs)}
                {first.plays > 0 && ` · ${first.plays} 次`}
              </p>
            </div>
          </Rise>
        </>
      }
      right={
        <div role="list" className="flex w-full flex-col gap-1">
          {rest.map((c, i) => (
            <Rise key={c.convId} i={2 + i}>
              <div role="listitem" className="flex h-16 items-center gap-4">
                <span className="w-4 shrink-0 text-sm tabular-nums text-app-muted">{i + 2}</span>
                <Avatar conv={c} size={40} />
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                    <span className="shrink-0 text-sm tabular-nums text-app-secondary">{formatWatchShort(c.watchMs)}</span>
                  </span>
                  <span className="h-1.5 w-full overflow-hidden rounded-full bg-app-hover/[0.07]">
                    <span
                      className="recap-bar block h-full rounded-full bg-app-accent"
                      style={{ width: `${Math.max(2, (c.watchMs / max) * 100)}%`, "--i": i } as React.CSSProperties}
                    />
                  </span>
                </span>
              </div>
            </Rise>
          ))}
        </div>
      }
    />
  );
}

function Avatar({ conv, size }: { conv: StatsTopConv; size: number }) {
  const full = useConversationsStore((s) => s.list.find((c) => c.id === conv.convId));
  return full ? (
    <ConvAvatar conv={full} size={size} />
  ) : (
    <span className="shrink-0 rounded-[24%] bg-app-subtle" style={{ width: size, height: size }} />
  );
}

// ─── Summary ────────────────────────────────────────────────────────────────

export function SummarySlide({ d, nav }: { d: RecapData; nav: Nav }) {
  const { o, r, period, lib } = d;
  const space = useLibrariesStore((s) => s.list.find((l) => l.id === lib)?.name);
  const added = sum(o.added.map((a) => a.image + a.video + a.other));
  const taken = sum(r.taken);
  const peak = o.hours.reduce((b, v, h) => (v > o.hours[b] ? h : b), 0);
  const tiles: [string, string][] = [
    ["新增", `${added.toLocaleString()} 项`],
    ["拍摄", `${taken.toLocaleString()} 项`],
    ["足迹", `${r.placeCount.toLocaleString()} 个地方`],
    ["观看", o.totalMs > 0 ? formatWatchShort(o.totalMs) : "—"],
    ["次数", o.plays.toLocaleString()],
    ["最常在", o.totalMs > 0 ? `${peak} 点` : "—"],
  ];
  const strip = r.covers.slice(0, 4);
  return (
    <div className="flex flex-col items-center gap-7">
      <Rise i={0}>
        <article className="flex w-[min(400px,calc(100vw-200px))] flex-col gap-6 rounded-2xl border border-app-hover/10 bg-app-panel/80 p-6 shadow-2xl backdrop-blur-sm">
          {strip.length > 0 && (
            <div className="grid grid-cols-4 gap-1.5">
              {strip.map((c) => (
                <Thumb key={c.mediaId} lib={lib} cover={c} className="aspect-square w-full rounded-lg" />
              ))}
            </div>
          )}
          <header className="flex items-end justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-[34px] font-semibold leading-none tracking-tight tabular-nums">
                {period.kind === "year" ? period.y : `${period.m + 1}月`}
              </p>
              <p className="text-sm text-app-secondary">{period.kind === "year" ? "年度回顾" : `${period.y}年 · 月度回顾`}</p>
            </div>
            <p className="min-w-0 truncate text-xs text-app-muted">{space}</p>
          </header>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-app-hover/[0.07]">
            {tiles.map(([label, value]) => (
              <div key={label} className="flex min-w-0 flex-col gap-1 bg-app-panel px-3 py-3">
                <span className="truncate text-base font-semibold tabular-nums">{value}</span>
                <span className="text-2xs text-app-muted">{label}</span>
              </div>
            ))}
          </div>
        </article>
      </Rise>
      <Rise i={2} className="flex gap-3">
        <button type="button" onClick={nav.restart} className={cn(PILL, "bg-app-hover/10 text-app-fg hover:bg-app-hover/[0.16]")}>
          <RotateCcw size={15} />
          从头看
        </button>
        <button type="button" onClick={nav.close} className={cn(PILL, "bg-app-fg text-app hover:bg-app-fg/85")}>
          完成
        </button>
      </Rise>
    </div>
  );
}
