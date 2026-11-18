import { useEffect, useState } from "react";
import {
  AudioLines,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  GalleryVerticalEnd,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { statsOverview } from "../../ipc/client";
import { cn } from "../../lib/cn";
import {
  bucketEdges,
  bucketLabel,
  bucketName,
  currentBucket,
  currentPeriod,
  drillDown,
  elapsedDays,
  formatAxis,
  formatWatch,
  formatWatchShort,
  niceMax,
  periodRange,
  periodTitle,
  samePeriod,
  shift,
  switchKind,
  watchParts,
  type Period,
  type PeriodKind,
} from "../../lib/statsPeriod";
import { useConversationsStore } from "../../stores/conversations";
import { useLibrariesStore } from "../../stores/libraries";
import { useMessagesStore } from "../../stores/messages";
import { useAudioStore } from "../../stores/audio";
import { useSessionStore } from "../../stores/session";
import { useSettingsStore } from "../../stores/settings";
import { useThumbUrl } from "../../stores/thumbs";
import type { StatsOverview, StatsTopConv, StatsTopItem } from "../../types";
import { Button, IconButton } from "../ui/Button";
import { ConvAvatar } from "../ui/ConvAvatar";
import { Segmented } from "../ui/Segmented";
import { RecapView } from "./RecapView";

const KINDS: readonly { value: PeriodKind; label: string }[] = [
  { value: "day", label: "日" },
  { value: "week", label: "周" },
  { value: "month", label: "月" },
  { value: "year", label: "年" },
];

const STEP: Record<PeriodKind, [string, string]> = {
  day: ["前一天", "后一天"],
  week: ["前一周", "后一周"],
  month: ["前一个月", "后一个月"],
  year: ["前一年", "后一年"],
};

export function StatsView() {
  const open = useSessionStore((s) => s.view === "stats");
  const lib = useLibrariesStore((s) => s.current);
  if (!open || lib === null) return null;
  // Keyed by space: ids are per space, nothing carries over.
  return <StatsPage key={lib} lib={lib} />;
}

interface Loaded {
  period: Period;
  overview: StatsOverview;
  /** The period before, for the comparison. */
  previousMs: number;
}

function StatsPage({ lib }: { lib: string }) {
  const setView = useSessionStore((s) => s.setView);
  const recording = useSettingsStore((s) => s.settings.viewStats === "on");
  const [period, setPeriod] = useState<Period>(() => currentPeriod("week"));
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [recap, setRecap] = useState<Period | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cur = bucketEdges(period);
    const prev = bucketEdges(shift(period, -1));
    const first = (a: number[]) => [a[0], a[a.length - 1]];
    Promise.all([
      statsOverview(lib, cur.edges, cur.utcEdges),
      statsOverview(lib, first(prev.edges), first(prev.utcEdges)),
    ])
      .then(([overview, before]) => {
        if (!cancelled) {
          setData({ period, overview, previousMs: before.totalMs });
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lib, period]);

  const isCurrent = samePeriod(period, currentPeriod(period.kind));
  // Keep the last numbers on screen while the next period loads.
  const loading = !failed && (data === null || !samePeriod(data.period, period));
  const range = periodRange(period);

  const openItem = (item: StatsTopItem) => {
    const s = useSessionStore.getState();
    s.setView("chats");
    s.setActiveConversation(item.convId);
    void useMessagesStore.getState().load(item.convId);
    if (item.kind === "audio") {
      if (item.mediaId !== null) {
        useAudioStore.getState().play({ lib, messageId: item.messageId, mediaId: item.mediaId, convId: item.convId, title: item.name, durationMs: null });
      }
      return;
    }
    s.openLightbox(item.messageId);
  };
  const openConv = (c: StatsTopConv) => {
    const s = useSessionStore.getState();
    s.setView("chats");
    s.setActiveConversation(c.convId);
  };

  return (
    <div className="fixed inset-y-0 left-16 right-0 z-40 flex flex-col border-l border-app-border bg-app">
      <header
        data-drag-region
        className="flex h-[52px] shrink-0 items-center gap-2 border-b border-app-border bg-app-panel pl-2.5 pr-[calc(var(--wc-width)+10px)]"
      >
        <IconButton label="返回会话" icon={<ArrowLeft size={18} />} onClick={() => setView("chats")} />
        <span className="text-base font-semibold">统计</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[880px] flex-col gap-4 px-8 pb-10 pt-6">
          {/* Which period, and the controls that change it, in one row on the content's edges. */}
          <div className="flex h-8 items-center gap-3">
            <h1 className="shrink-0 whitespace-nowrap text-lg font-semibold">{periodTitle(period)}</h1>
            {range && <span className="min-w-0 truncate text-xs text-app-muted">{range}</span>}
            {loading && <Loader2 size={14} className="shrink-0 animate-spin text-app-muted" />}
            <span className="flex-1" />
            {(period.kind === "month" || period.kind === "year") && (
              <Button size="sm" variant="ghost" icon={<GalleryVerticalEnd size={14} />} onClick={() => setRecap(period)}>
                回顾
              </Button>
            )}
            <div className="flex items-center">
              <IconButton label={STEP[period.kind][0]} size="sm" icon={<ChevronLeft size={16} />} onClick={() => setPeriod((p) => shift(p, -1))} />
              <IconButton
                label={STEP[period.kind][1]}
                size="sm"
                icon={<ChevronRight size={16} />}
                disabled={isCurrent}
                onClick={() => setPeriod((p) => shift(p, 1))}
              />
            </div>
            <Segmented value={period.kind} options={KINDS} onChange={(k) => setPeriod((p) => switchKind(p, k))} />
          </div>

          {failed && !data ? (
            <p className="py-16 text-center text-sm text-app-muted">无法读取统计</p>
          ) : data ? (
            <Overview data={data} lib={lib} recording={recording} onDrill={setPeriod} onItem={openItem} onConv={openConv} />
          ) : null}
        </div>
      </div>

      {recap && <RecapView lib={lib} period={recap} onClose={() => setRecap(null)} />}
    </div>
  );
}

function Overview({
  data,
  lib,
  recording,
  onDrill,
  onItem,
  onConv,
}: {
  data: Loaded;
  lib: string;
  recording: boolean;
  onDrill: (p: Period) => void;
  onItem: (i: StatsTopItem) => void;
  onConv: (c: StatsTopConv) => void;
}) {
  const { period, overview: o } = data;
  const days = period.kind === "day" ? 1 : elapsedDays(period);
  const now = currentBucket(period);
  const showHours = period.kind !== "day";

  const videoMs = o.buckets.reduce((s, b) => s + b.videoMs, 0);
  const imageMs = o.buckets.reduce((s, b) => s + b.imageMs, 0);
  const audioMs = o.buckets.reduce((s, b) => s + b.audioMs, 0);

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Label>观看时长</Label>
            <BigDuration ms={o.totalMs} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Compare data={data} />
              {!recording && <span className="text-xs text-app-muted">观看记录已关闭</span>}
            </div>
          </div>
          <div className="flex shrink-0 gap-6 pt-0.5">
            {period.kind !== "day" && <Fact label="日均" value={formatWatchShort(o.totalMs / days)} />}
            <Fact label="次数" value={o.plays.toLocaleString()} />
          </div>
        </div>

        <StackedBars
          className="mt-6"
          period={period}
          o={o}
          current={now}
          onPick={
            period.kind === "day"
              ? undefined
              : (i) => {
                  const p = drillDown(period, i);
                  if (p) onDrill(p);
                }
          }
        />

        <div className="mt-4 flex items-center gap-5 text-xs text-app-secondary">
          <Legend swatch="bg-app-accent" label="视频" value={formatWatchShort(videoMs)} />
          <Legend swatch="bg-app-accent/35" label="图片" value={formatWatchShort(imageMs)} />
          {audioMs > 0 && <Legend swatch="bg-app-accent/65" label="录音" value={formatWatchShort(audioMs)} />}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <Label>最常看</Label>
          {o.topItems.length === 0 ? (
            <Empty />
          ) : (
            <ul className="-mx-2 mt-2 flex flex-col">
              {o.topItems.map((item) => (
                <ItemRow key={item.messageId} lib={lib} item={item} onClick={() => onItem(item)} />
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <Label>会话</Label>
          {o.topConvs.length === 0 ? (
            <Empty />
          ) : (
            <ul className="-mx-2 mt-2 flex flex-col">
              {o.topConvs.map((c) => (
                <ConvRow key={c.convId} conv={c} max={o.topConvs[0].watchMs} onClick={() => onConv(c)} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Habits and growth change slowly: last. */}
      <div className={cn("grid grid-cols-1 gap-4", showHours && "md:grid-cols-2")}>
        {showHours && <HoursCard hours={o.hours} total={o.totalMs} />}
        <AddedCard period={period} o={o} current={now} />
      </div>
    </>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-app-border/70 bg-app-panel p-5 shadow-[0_1px_2px_rgb(var(--shadow)/0.04)]">
      <div className="flex h-full flex-col">{children}</div>
    </section>
  );
}

/** Every card opens with the same quiet label; an optional note sits on its right. */
function Label({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <h2 className="text-xs font-medium text-app-secondary">{children}</h2>
      <span className="flex-1" />
      {aside && <span className="text-xs tabular-nums text-app-muted">{aside}</span>}
    </div>
  );
}

function Empty() {
  return <p className="py-10 text-center text-xs text-app-muted">没有记录</p>;
}

function BigDuration({ ms }: { ms: number }) {
  return (
    <span className="flex items-baseline gap-1.5 leading-none">
      {watchParts(ms).map(([n, unit]) => (
        <span key={unit} className="flex items-baseline gap-0.5">
          <span className="text-[40px] font-semibold tracking-tight tabular-nums">{n}</span>
          <span className="text-base font-medium text-app-secondary">{unit}</span>
        </span>
      ))}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-xs text-app-muted">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}

const AGAINST: Record<PeriodKind, string> = { day: "前一天", week: "前一周", month: "前一个月", year: "前一年" };

/** Daily average against the period before (a whole day for the day view,
 *  and only once that day is over: half a day against a whole one says nothing). */
function Compare({ data }: { data: Loaded }) {
  const { period, overview: o, previousMs } = data;
  if (period.kind === "day" && currentBucket(period) !== null) return null;
  const nowAvg = o.totalMs / (period.kind === "day" ? 1 : elapsedDays(period));
  const prevAvg = previousMs / (period.kind === "day" ? 1 : elapsedDays(shift(period, -1)));
  if (prevAvg <= 0 || nowAvg <= 0) return null;
  const pct = Math.round(((nowAvg - prevAvg) / prevAvg) * 100);
  const Icon = pct >= 0 ? TrendingUp : TrendingDown;
  const what = period.kind === "day" ? "" : "日均";
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full bg-app-subtle px-2 text-xs text-app-secondary">
      <Icon size={13} className="text-app-accent" />
      {pct === 0 ? `${what}与${AGAINST[period.kind]}持平` : `${what}比${AGAINST[period.kind]}${pct > 0 ? "多" : "少"} ${Math.abs(pct)}%`}
    </span>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-[3px]", swatch)} />
      {label}
      <span className="tabular-nums text-app-muted">{value}</span>
    </span>
  );
}

// ─── Charts ─────────────────────────────────────────────────────────────────

function GridLines({ max, axis, height }: { max: number; axis: (v: number) => string; height: number }) {
  return (
    <div className="relative w-10 shrink-0 whitespace-nowrap text-2xs tabular-nums text-app-muted" style={{ height }}>
      {max > 0 && (
        <>
          <span className="absolute left-0 top-0 -translate-y-1/2">{axis(max)}</span>
          <span className="absolute left-0 top-1/2 -translate-y-1/2">{axis(max / 2)}</span>
        </>
      )}
    </div>
  );
}

function Rules({ show }: { show: boolean }) {
  return (
    <>
      {show && (
        <>
          <span className="absolute inset-x-0 top-0 border-t border-dashed border-app-border" />
          <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-app-border" />
        </>
      )}
      <span className="absolute inset-x-0 bottom-0 border-t border-app-border" />
    </>
  );
}

function AxisLabels({ labels, current, dense }: { labels: string[]; current: number | null; dense: boolean }) {
  return (
    <div className={cn("mt-2 flex", dense ? "gap-[3px]" : "gap-2")}>
      {labels.map((l, i) => (
        <span
          key={i}
          className={cn(
            "min-w-0 flex-1 overflow-visible whitespace-nowrap text-2xs tabular-nums",
            !dense && "text-center",
            i === current ? "font-semibold text-app-accent" : "text-app-muted",
            current !== null && i > current && "opacity-50",
          )}
        >
          {l}
        </span>
      ))}
    </div>
  );
}

/** Time per bucket, videos below and images above in two shades of the accent. */
function StackedBars({
  period,
  o,
  current,
  onPick,
  className,
}: {
  period: Period;
  o: StatsOverview;
  current: number | null;
  onPick?: (i: number) => void;
  className?: string;
}) {
  const height = 168;
  const highest = Math.max(0, ...o.buckets.map((b) => b.totalMs));
  const max = highest > 0 ? niceMax(highest) : 0;
  const dense = o.buckets.length > 12;
  return (
    <div className={cn("flex gap-3", className)}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative" style={{ height }}>
          <Rules show={max > 0} />
          <div className={cn("absolute inset-0 flex items-end", dense ? "gap-[3px]" : "gap-2")}>
            {o.buckets.map((b, i) => {
              const h = max > 0 ? (b.totalMs / max) * 100 : 0;
              const kinds = b.videoMs + b.imageMs + b.audioMs;
              const videoShare = kinds > 0 ? b.videoMs / kinds : 1;
              const audioShare = kinds > 0 ? b.audioMs / kinds : 0;
              const parts = [
                b.videoMs > 0 ? `视频 ${formatWatch(b.videoMs)}` : "",
                b.imageMs > 0 ? `图片 ${formatWatch(b.imageMs)}` : "",
                b.audioMs > 0 ? `录音 ${formatWatch(b.audioMs)}` : "",
              ].filter(Boolean);
              const tip = [bucketName(period, i), formatWatch(b.totalMs), parts.length > 1 ? parts.join(" · ") : ""]
                .filter(Boolean)
                .join("\n");
              const bar = (
                <span
                  className="mx-auto flex w-full max-w-8 flex-col-reverse overflow-hidden rounded-t-md transition-[filter] duration-fast group-hover:brightness-110"
                  style={{ height: `${h}%`, minHeight: b.totalMs > 0 ? 3 : 0 }}
                >
                  <span className="w-full bg-app-accent" style={{ height: `${videoShare * 100}%` }} />
                  {audioShare > 0 && <span className="w-full bg-app-accent/65" style={{ height: `${audioShare * 100}%` }} />}
                  <span className="w-full flex-1 bg-app-accent/35" />
                </span>
              );
              // Still to come: nothing to point at.
              if (current !== null && i > current) {
                return <div key={i} className="h-full min-w-0 flex-1" />;
              }
              const cls = "group flex h-full min-w-0 flex-1 items-end rounded-t-lg transition-colors duration-fast hover:bg-app-hover/5";
              return onPick && b.totalMs > 0 ? (
                <button key={i} type="button" data-tip={tip} data-tip-side="top" onClick={() => onPick(i)} className={cls}>
                  {bar}
                </button>
              ) : (
                <div key={i} data-tip={tip} data-tip-side="top" className={cls}>
                  {bar}
                </div>
              );
            })}
          </div>
        </div>
        <AxisLabels labels={o.buckets.map((_, i) => bucketLabel(period, i))} current={current} dense={dense} />
      </div>
      <GridLines max={max} axis={formatAxis} height={height} />
    </div>
  );
}

/** Monotone cubic through the points: smooth, never overshooting below zero. */
function smoothPath(pts: [number, number][]): string {
  const n = pts.length;
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  let path = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = (x1 - x0) / 3;
    path += ` C${x0 + h},${y0 + m[i] * h} ${x1 - h},${y1 - m[i + 1] * h} ${x1},${y1}`;
  }
  return path;
}

function HoursCard({ hours, total }: { hours: number[]; total: number }) {
  const W = 240;
  const H = 100;
  const height = 104;
  const peak = hours.reduce((best, v, h) => (v > hours[best] ? h : best), 0);
  const max = Math.max(...hours);
  const y = (v: number) => (max > 0 ? H - (v / max) * H * 0.86 : H);
  const pts: [number, number][] = [[0, y(hours[0])], ...hours.map((v, h): [number, number] => [((h + 0.5) / 24) * W, y(v)]), [W, y(hours[23])]];
  const line = smoothPath(pts);
  return (
    <Card>
      <Label aside={total > 0 ? `${peak}:00 最多` : undefined}>时段</Label>
      <div className="relative mt-4" style={{ height }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          <defs>
            <linearGradient id="stats-hours-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.32" />
              <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
            </linearGradient>
          </defs>
          {max > 0 && (
            <>
              <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#stats-hours-fill)" />
              <path d={line} fill="none" stroke="rgb(var(--accent))" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </>
          )}
          <line x1="0" y1={H} x2={W} y2={H} stroke="rgb(var(--line))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>
        {max > 0 && (
          <span
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-app-panel bg-app-accent shadow-sm"
            style={{ left: `${((peak + 0.5) / 24) * 100}%`, top: `${(y(hours[peak]) / H) * 100}%` }}
          />
        )}
        {/* Hover targets: one per hour, with a faint column under the pointer. */}
        <div className="absolute inset-0 flex">
          {hours.map((ms, h) => (
            <div
              key={h}
              data-tip={`${h}:00–${h + 1}:00\n${formatWatch(ms)}`}
              data-tip-side="top"
              className="h-full flex-1 rounded-sm transition-colors duration-fast hover:bg-app-hover/5"
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-between text-2xs tabular-nums text-app-muted">
        {["0", "6", "12", "18", "24"].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </Card>
  );
}

function niceCount(n: number): number {
  let step = 1;
  for (;;) {
    for (const k of [1, 2, 5]) if (n <= k * step) return k * step;
    step *= 10;
  }
}

function AddedCard({ period, o, current }: { period: Period; o: StatsOverview; current: number | null }) {
  const t = o.added.reduce(
    (a, b) => ({ image: a.image + b.image, video: a.video + b.video, audio: a.audio + b.audio, other: a.other + b.other }),
    { image: 0, video: 0, audio: 0, other: 0 },
  );
  const sum = t.image + t.video + t.audio + t.other;
  const values = o.added.map((a) => a.image + a.video + a.audio + a.other);
  const highest = Math.max(0, ...values);
  const max = highest > 0 ? niceCount(highest) : 0;
  const dense = values.length > 12;
  const height = 44;
  return (
    <Card>
      <Label aside={`共 ${(o.itemsBefore + sum).toLocaleString()} 项`}>新增</Label>
      <div className={cn("mt-3 grid gap-2", t.audio > 0 ? "grid-cols-4" : "grid-cols-3")}>
        <KindStat icon={<ImageIcon size={15} />} label="图片" n={t.image} />
        <KindStat icon={<Film size={15} />} label="视频" n={t.video} />
        {t.audio > 0 && <KindStat icon={<AudioLines size={15} />} label="录音" n={t.audio} />}
        <KindStat icon={<FileText size={15} />} label="文件" n={t.other} />
      </div>
      {sum > 0 && (
        // Bottom of the card, so it lines up with the hours chart beside it.
        <div className="mt-auto flex min-h-0 flex-1 flex-col pt-4">
          <div className="relative flex-1" style={{ minHeight: height }}>
            <span className="absolute inset-x-0 bottom-0 border-t border-app-border" />
            <div className={cn("absolute inset-0 flex items-end", dense ? "gap-[3px]" : "gap-2")}>
              {o.added.map((a, i) => {
                const v = values[i];
                const parts = [a.image ? `图片 ${a.image}` : "", a.video ? `视频 ${a.video}` : "", a.audio ? `录音 ${a.audio}` : "", a.other ? `文件 ${a.other}` : ""].filter(Boolean);
                return (
                  <div
                    key={i}
                    data-tip={current !== null && i > current ? undefined : `${bucketName(period, i)}\n${parts.length ? parts.join(" · ") : "无"}`}
                    data-tip-side="top"
                    className="flex h-full min-w-0 flex-1 items-end"
                  >
                    <span
                      className="mx-auto w-full max-w-8 rounded-t-[3px] bg-app-secondary/30"
                      style={{ height: `${max > 0 ? (v / max) * 100 : 0}%`, minHeight: v > 0 ? 2 : 0 }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <AxisLabels labels={o.added.map((_, i) => bucketLabel(period, i))} current={current} dense={dense} />
        </div>
      )}
    </Card>
  );
}

function KindStat({ icon, label, n }: { icon: React.ReactNode; label: string; n: number }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-app-subtle/70 px-2.5 py-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-app-accent/10 text-app-accent">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="text-base font-semibold leading-tight tabular-nums">{n.toLocaleString()}</span>
        <span className="text-2xs text-app-muted">{label}</span>
      </span>
    </div>
  );
}

// ─── Lists ──────────────────────────────────────────────────────────────────

function ItemRow({ lib, item, onClick }: { lib: string; item: StatsTopItem; onClick: () => void }) {
  const thumb = useThumbUrl(lib, item.mediaId === null ? null : { id: item.mediaId, hasThumb: item.hasThumb });
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex h-12 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors duration-fast hover:bg-app-hover/5"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-app-subtle text-app-muted">
          {thumb ? (
            <img src={thumb} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
          ) : item.kind === "video" ? (
            <Film size={16} />
          ) : item.kind === "audio" ? (
            <AudioLines size={16} />
          ) : (
            <ImageIcon size={16} />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">{item.name}</span>
          <span className="truncate text-xs text-app-muted">{item.convName}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="text-sm tabular-nums">{formatWatchShort(item.watchMs)}</span>
          <span className="text-xs tabular-nums text-app-muted">{item.plays > 0 ? `${item.plays} 次` : " "}</span>
        </span>
      </button>
    </li>
  );
}

function ConvRow({ conv, max, onClick }: { conv: StatsTopConv; max: number; onClick: () => void }) {
  const full = useConversationsStore((s) => s.list.find((c) => c.id === conv.convId));
  const pct = max > 0 ? Math.max(2, (conv.watchMs / max) * 100) : 0;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex h-12 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors duration-fast hover:bg-app-hover/5"
      >
        {full ? <ConvAvatar conv={full} size={36} /> : <span className="h-9 w-9 shrink-0 rounded-[9px] bg-app-subtle" />}
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm">{conv.name}</span>
            <span className="shrink-0 text-sm tabular-nums">{formatWatchShort(conv.watchMs)}</span>
          </span>
          <span className="h-1.5 w-full overflow-hidden rounded-full bg-app-subtle">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-app-accent/50 to-app-accent"
              style={{ width: `${pct}%` }}
            />
          </span>
        </span>
      </button>
    </li>
  );
}
