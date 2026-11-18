import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { statsOverview, statsRecap } from "../../ipc/client";
import { cn } from "../../lib/cn";
import { bucketEdges, dayEdges, periodTitle, shift, type Period } from "../../lib/statsPeriod";
import type { Recap, StatsOverview } from "../../types";
import { useEscapeLayer } from "../ui/Modal";
import {
  AddedSlide,
  CoverSlide,
  ConvsSlide,
  HoursSlide,
  PlacesSlide,
  SummarySlide,
  TakenSlide,
  TopItemsSlide,
  WatchSlide,
  type RecapData,
} from "./RecapSlides";

/**
 * Month / year recap (ADR-057): one full-window page at a time over a dark
 * stage, opened from the statistics page. Pages with nothing to show are
 * left out.
 */
export function RecapView({ lib, period, onClose }: { lib: string; period: Period; onClose: () => void }) {
  const [data, setData] = useState<RecapData | null>(null);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const cur = bucketEdges(period);
    const prev = bucketEdges(shift(period, -1));
    const days = dayEdges(period);
    const ends = (a: number[]) => [a[0], a[a.length - 1]];
    Promise.all([
      statsOverview(lib, cur.edges, cur.utcEdges),
      statsOverview(lib, ends(prev.edges), ends(prev.utcEdges)),
      statsRecap(lib, days.edges, days.utcEdges),
    ])
      .then(([overview, before, recap]: [StatsOverview, StatsOverview, Recap]) => {
        if (!cancelled) setData({ lib, period, o: overview, previousMs: before.totalMs, r: recap });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lib, period]);

  const slides = useMemo(() => (data ? buildSlides(data) : []), [data]);
  const count = slides.length;
  const go = useCallback((i: number) => setIndex(Math.max(0, Math.min(count - 1, i))), [count]);

  useEscapeLayer(true, onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      let to: number | null = null;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") to = index + 1;
      else if (e.key === "ArrowLeft" || e.key === "PageUp") to = index - 1;
      else if (e.key === "Home") to = 0;
      else if (e.key === "End") to = count - 1;
      if (to === null) return;
      e.preventDefault();
      go(to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count, go]);

  const slide = slides[index];
  const nav = { next: () => go(index + 1), restart: () => go(0), close: onClose };

  return (
    // Always the dark palette: photos and the accent read best on it.
    <div data-immersive className="dark fixed inset-0 z-50 flex flex-col overflow-hidden bg-app text-app-fg animate-fade-in">
      <Backdrop />

      <header data-drag-region className="relative z-10 flex h-[52px] shrink-0 items-center pl-5 pr-[calc(var(--wc-width)+10px)]">
        <span className="text-xs font-medium text-app-muted">{periodTitle(period)}</span>
        {count > 1 && (
          <div className="absolute left-1/2 top-1/2 flex w-[min(440px,38vw)] -translate-x-1/2 -translate-y-1/2 gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.key}
                type="button"
                aria-label={s.label}
                data-tip={s.label}
                onClick={() => go(i)}
                className="group flex h-5 min-w-0 flex-1 items-center"
              >
                <span
                  className={cn(
                    "h-[3px] w-full rounded-full transition-colors duration-slow",
                    i === index ? "bg-app-fg" : i < index ? "bg-app-fg/45" : "bg-app-fg/15 group-hover:bg-app-fg/30",
                  )}
                />
              </button>
            ))}
          </div>
        )}
      </header>

      <button
        type="button"
        onClick={onClose}
        data-tip="关闭  Esc"
        aria-label="关闭"
        className="absolute right-4 top-[60px] z-10 flex h-9 w-9 items-center justify-center rounded-full bg-app-hover/10 text-app-fg transition-colors duration-fast hover:bg-app-hover/20"
      >
        <X size={20} />
      </button>

      <main className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-[88px] pb-12 pt-4">
        {failed && !data ? (
          <p className="text-sm text-app-secondary">无法读取统计</p>
        ) : !slide ? (
          <Loader2 size={28} className="animate-spin text-app-muted" />
        ) : (
          // Keyed by page: each one plays its entrance afresh.
          <div key={slide.key} className="flex max-h-full w-full max-w-[1040px] justify-center">
            {slide.render(nav)}
          </div>
        )}
      </main>

      {index > 0 && (
        <SideButton side="left" label="上一页  ←" onClick={() => go(index - 1)}>
          <ChevronLeft size={24} />
        </SideButton>
      )}
      {index < count - 1 && (
        <SideButton side="right" label="下一页  →" onClick={() => go(index + 1)}>
          <ChevronRight size={24} />
        </SideButton>
      )}
    </div>
  );
}

function SideButton({
  side,
  label,
  onClick,
  children,
}: {
  side: "left" | "right";
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tip={label}
      aria-label={label}
      className={cn(
        "absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-app-hover/10 text-app-fg transition-colors duration-fast hover:bg-app-hover/20",
        side === "left" ? "left-5" : "right-5",
      )}
    >
      {children}
    </button>
  );
}

/** Two soft pools of the accent in opposite corners; nothing else. */
function Backdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "radial-gradient(900px 520px at 12% -8%, rgb(var(--accent) / 0.20), transparent 62%)," +
          "radial-gradient(760px 480px at 105% 108%, rgb(var(--accent) / 0.12), transparent 60%)",
      }}
    />
  );
}

// ─── Which pages ────────────────────────────────────────────────────────────

export interface Nav {
  next: () => void;
  restart: () => void;
  close: () => void;
}

interface Slide {
  key: string;
  label: string;
  render: (nav: Nav) => React.ReactNode;
}

function buildSlides(d: RecapData): Slide[] {
  const { o, r } = d;
  const added = o.added.reduce((s, a) => s + a.image + a.video + a.other, 0);
  const taken = r.taken.reduce((s, n) => s + n, 0);
  const watched = o.totalMs > 0;
  const anything = added > 0 || taken > 0 || watched;

  const out: Slide[] = [{ key: "cover", label: "封面", render: (nav) => <CoverSlide d={d} empty={!anything} nav={nav} /> }];
  if (!anything) return out;
  if (added > 0) out.push({ key: "added", label: "新增", render: () => <AddedSlide d={d} /> });
  if (taken > 0) out.push({ key: "taken", label: "拍摄", render: () => <TakenSlide d={d} /> });
  if (r.geoCount > 0) out.push({ key: "places", label: "足迹", render: () => <PlacesSlide d={d} /> });
  if (watched) {
    out.push({ key: "watch", label: "观看", render: () => <WatchSlide d={d} /> });
    out.push({ key: "hours", label: "时段", render: () => <HoursSlide d={d} /> });
  }
  if (o.topItems.length > 0) out.push({ key: "items", label: "最常看", render: () => <TopItemsSlide d={d} /> });
  if (o.topConvs.length > 1) out.push({ key: "convs", label: "会话", render: () => <ConvsSlide d={d} /> });
  out.push({ key: "summary", label: "总览", render: (nav) => <SummarySlide d={d} nav={nav} /> });
  return out;
}
