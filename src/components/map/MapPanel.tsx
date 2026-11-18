import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CloudOff, ImageOff, PanelRightClose, Play } from "lucide-react";
import { mediaSrc } from "../../ipc/client";
import { isHeicExt } from "../../lib/heic";
import { isImageMedia } from "../../lib/media";
import { photoYearMonth } from "../../lib/datetime";
import { useThumbUrl } from "../../stores/thumbs";
import type { GeotaggedMedia } from "../../types";
import { IconButton } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";

/** Thumbnails rendered at first, and added per scroll to the end. */
const PAGE = 150;

interface MapPanelProps {
  lib: string;
  /** Newest first. */
  items: GeotaggedMedia[];
  /** A stack is selected; otherwise the list follows the visible area. */
  selected: boolean;
  onBack: () => void;
  onCollapse: () => void;
  onOpen: (index: number) => void;
}

interface MonthGroup {
  label: string;
  /** Index of the group's first item in `items`. */
  start: number;
  items: GeotaggedMedia[];
}

function groupByMonth(items: GeotaggedMedia[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  let key = "";
  items.forEach((m, i) => {
    const [y, mo] = photoYearMonth(m);
    const k = `${y}年${mo}月`;
    if (k !== key) {
      key = k;
      groups.push({ label: k, start: i, items: [] });
    }
    groups[groups.length - 1].items.push(m);
  });
  return groups;
}

/** What's at the selected spot, or in the visible area, docked like the
 *  conversation info panel. */
export function MapPanel({ lib, items, selected, onBack, onCollapse, onOpen }: MapPanelProps) {
  const [limit, setLimit] = useState(PAGE);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);

  // A different list starts from the top again.
  useEffect(() => {
    setLimit(PAGE);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [items]);

  const groups = useMemo(() => groupByMonth(items.slice(0, limit)), [items, limit]);
  const hasMore = items.length > limit;

  useEffect(() => {
    const el = moreRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + PAGE);
      },
      { root: scrollRef.current, rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, limit]);

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-app-border bg-app-panel">
      <header data-drag-region className="flex h-[52px] shrink-0 items-center gap-1 pl-4 pr-[calc(var(--wc-width)+10px)]">
        {selected && (
          <IconButton label="返回此区域" size="sm" className="-ml-1.5" icon={<ArrowLeft size={16} />} onClick={onBack} />
        )}
        <span className="shrink-0 text-sm font-semibold">{selected ? "此位置" : "此区域"}</span>
        <span className="min-w-0 flex-1 truncate pl-1 text-xs text-app-muted">{items.length.toLocaleString()}</span>
        <IconButton label="收起" size="sm" icon={<PanelRightClose size={16} />} onClick={onCollapse} />
      </header>

      {items.length === 0 ? (
        <EmptyState className="flex-1" title="此区域没有图片或视频" />
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {groups.map((g, gi) => (
            <section key={g.label}>
              <h3 className={"pb-1.5 text-xs font-medium text-app-muted " + (gi === 0 ? "pt-1" : "pt-3")}>{g.label}</h3>
              <div className="grid grid-cols-3 gap-1">
                {g.items.map((m, i) => (
                  <PanelThumb key={m.mediaId} lib={lib} item={m} onClick={() => onOpen(g.start + i)} />
                ))}
              </div>
            </section>
          ))}
          {hasMore && <div ref={moreRef} className="h-px" />}
        </div>
      )}
    </aside>
  );
}

function PanelThumb({ lib, item, onClick }: { lib: string; item: GeotaggedMedia; onClick: () => void }) {
  const thumb = useThumbUrl(lib, { id: item.mediaId, hasThumb: item.hasThumb });
  const reachable = item.status === "ok";
  // No thumbnail yet: plain image formats can show the original meanwhile.
  const fallback = !thumb && reachable && isImageMedia(item) && !isHeicExt(item.ext) ? mediaSrc(lib, item.mediaId) : null;
  const src = thumb ?? fallback;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!reachable && !src}
      data-tip={item.status === "offline" ? "离线" : item.status === "missing" ? "缺失" : undefined}
      className="group relative aspect-square overflow-hidden rounded-md bg-app-subtle"
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className={
            "h-full w-full object-cover transition-opacity duration-fast group-hover:opacity-90" +
            (reachable ? "" : " opacity-60 grayscale")
          }
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-app-muted">
          <ImageOff size={18} />
        </span>
      )}
      {item.kind === "video" && (
        <span className="absolute bottom-1 left-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-black/50 text-white">
          <Play size={8} fill="currentColor" />
        </span>
      )}
      {!reachable && (
        <span className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white">
          {item.status === "offline" ? <CloudOff size={10} /> : <ImageOff size={10} />}
        </span>
      )}
    </button>
  );
}
