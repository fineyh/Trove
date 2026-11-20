import {
  AudioLines,
  Calendar,
  Camera,
  Eye,
  File as FileIcon,
  Film,
  Image as ImageIcon,
  MapPin,
  PanelRightClose,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as ipc from "../../ipc/client";
import { cn } from "../../lib/cn";
import { formatFullDateTime, formatTakenTime, formatUtcOffset } from "../../lib/datetime";
import { formatBytes, formatDuration, isImageMedia } from "../../lib/media";
import { formatViewTime, formatWatch } from "../../lib/statsPeriod";
import { useIsDark } from "../../lib/useIsDark";
import { useMessagesStore } from "../../stores/messages";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import type { ItemHistory, MediaDetails, MediaPayload, Message } from "../../types";
import { useMapEnabled } from "../map/MapView";
import { ViewHistoryDialog } from "../stats/ViewHistoryDialog";
import { IconButton } from "../ui/Button";
import { useEscapeLayer } from "../ui/Modal";
import { MiniMap } from "./MiniMap";

interface InfoPanelProps {
  lib: string;
  /** A media message. */
  message: Message;
  /** "viewer": inside a fullscreen viewer, which is always dark.
   *  "dock": beside the chat, in place of the conversation info. */
  place: "viewer" | "dock";
  /** Dock: the collapse button. */
  onClose?: () => void;
  /** Dock: the preview at the top opens the item in the viewer. */
  onOpen?: () => void;
  /** Where "show on map" goes, if not the default (the map's own viewer). */
  onShowOnMap?: () => void;
  /** The caption was saved, for a host that holds its own copy of the message. */
  onCaptionSaved?: (caption: string | null) => void;
}

/**
 * Everything about one item in one place (ADR-062): what the user wrote at
 * the top, then what the file says. The viewers and the chat's right dock
 * show the same panel.
 */
export function InfoPanel({ lib, message, place, onClose, onOpen, onShowOnMap, onCaptionSaved }: InfoPanelProps) {
  const media = message.media!;
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [history, setHistory] = useState<ItemHistory | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const mapEnabled = useMapEnabled();
  const appDark = useIsDark();
  const showOnMap = useSessionStore((s) => s.showOnMap);
  const openMissing = useSessionStore((s) => s.setMissingFilesOpen);

  const watchable = media.kind === "video" || media.kind === "audio" || isImageMedia(media);

  useEffect(() => {
    let live = true;
    setDetails(null);
    setHistory(null);
    ipc
      .mediaDetails(lib, media.id)
      .then((d) => live && setDetails(d))
      .catch(() => {});
    if (watchable) {
      ipc
        .statsItemHistory(lib, message.id)
        .then((h) => live && setHistory(h))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [lib, media.id, message.id, watchable]);

  const reveal = () => void ipc.revealMedia(lib, media.id).catch((e) => toast.error("无法打开文件夹", e));
  const thumb = media.hasThumb ? ipc.thumbSrc(lib, media.id) : null;
  const camera = details?.camera ?? null;
  const geo = details && details.lat != null && details.lon != null ? { lat: details.lat, lon: details.lon } : null;
  const last = history?.views[0];

  return (
    <aside
      className="flex h-full w-[320px] shrink-0 flex-col border-l border-app-border bg-app-panel text-app-fg"
      onClick={(e) => e.stopPropagation()}
    >
      <header data-drag-region className="flex h-[52px] shrink-0 items-center gap-1 pl-5 pr-[calc(var(--wc-width)+10px)]">
        <span className="flex-1 text-sm font-semibold">信息</span>
        {onClose && <IconButton label="收起" size="sm" icon={<PanelRightClose size={16} />} onClick={onClose} />}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5">
        {place === "dock" && thumb && (
          <button
            type="button"
            onClick={onOpen}
            disabled={!onOpen}
            className="mb-2 block w-full overflow-hidden rounded-lg bg-app-subtle"
            style={{ aspectRatio: previewRatio(media) }}
            data-tip={onOpen ? "打开" : undefined}
          >
            <img src={thumb} alt="" draggable={false} className="h-full w-full object-cover" />
          </button>
        )}

        <CaptionField message={message} onSaved={onCaptionSaved} />

        <div className="mx-2 my-2 h-px bg-app-border" />

        <TimeRow message={message} />

        <Row
          icon={<KindIcon media={media} />}
          title={<span className="break-all">{media.name}</span>}
          sub={
            <Facts
              items={[
                media.width && media.height ? `${media.width} × ${media.height}` : null,
                media.durationMs ? formatDuration(media.durationMs) : null,
                formatBytes(media.sizeBytes),
              ]}
              status={media.status}
            />
          }
          tip={media.status === "ok" ? "在资源管理器中显示" : media.status === "missing" ? "重新链接" : undefined}
          onClick={media.status === "ok" ? reveal : media.status === "missing" ? () => openMissing(true) : undefined}
        />

        {camera && (
          <Row
            icon={<Camera size={16} />}
            title={camera.model ?? "相机"}
            sub={
              <Facts
                spaced
                items={[
                  camera.focalMm ? `${Math.round(camera.focalMm)} mm` : null,
                  camera.fNumber ? `ƒ/${trimZero(camera.fNumber.toFixed(1))}` : null,
                  camera.exposure ? `${camera.exposure} s` : null,
                  camera.iso ? `ISO ${camera.iso}` : null,
                ]}
              />
            }
            tip={camera.lens ?? undefined}
          />
        )}

        {geo &&
          (mapEnabled ? (
            <button
              type="button"
              onClick={onShowOnMap ?? (() => showOnMap(media.id))}
              className="mt-1 flex w-full flex-col gap-2 rounded-lg p-2 text-left transition-colors duration-fast hover:bg-app-hover/5 active:bg-app-hover/10"
              data-tip="在地图上显示"
            >
              <MiniMap
                lib={lib}
                lat={geo.lat}
                lon={geo.lon}
                mediaId={media.id}
                hasThumb={media.hasThumb}
                dark={place === "viewer" || appDark}
              />
              <span className="flex items-center gap-3 text-xs tabular-nums text-app-secondary">
                <MapPin size={16} className="shrink-0 text-app-muted" />
                {formatCoords(geo.lat, geo.lon)}
              </span>
            </button>
          ) : (
            <Row icon={<MapPin size={16} />} title={<span className="tabular-nums">{formatCoords(geo.lat, geo.lon)}</span>} />
          ))}

        {history && history.viewCount > 0 && (
          <Row
            icon={<Eye size={16} />}
            title={
              history.plays > 0
                ? `${media.kind === "image" || isImageMedia(media) ? "查看" : "播放"} ${history.plays} 次 · ${formatWatch(history.totalMs)}`
                : formatWatch(history.totalMs)
            }
            sub={last ? `最近 ${formatViewTime(last.startedAt, last.tzOffset)}` : undefined}
            tip="观看记录"
            onClick={() => setHistoryOpen(true)}
          />
        )}
      </div>

      <ViewHistoryDialog lib={lib} message={historyOpen ? message : null} onClose={() => setHistoryOpen(false)} />
    </aside>
  );
}

// ─── Caption ────────────────────────────────────────────────────────────────

/**
 * The user's own words about the item. Edited in place: Enter or leaving the
 * field saves, Shift+Enter is a new line, Esc puts it back.
 */
function CaptionField({
  message,
  onSaved,
}: {
  message: Message;
  onSaved?: (caption: string | null) => void;
}) {
  const setCaption = useMessagesStore((s) => s.setCaption);
  const saved = message.caption ?? "";
  const [draft, setDraft] = useState(saved);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);

  // Another item, or saved from elsewhere: show what's stored.
  useEffect(() => {
    setDraft(saved);
  }, [message.id, saved]);

  // Grows with what's written.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  useEscapeLayer(focused, () => {
    cancelled.current = true;
    setDraft(saved);
    ref.current?.blur();
  });

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = draft.trim();
    if (next === saved.trim()) {
      setDraft(saved);
      return;
    }
    const { id, convId } = message;
    setCaption(convId, id, next)
      .then(() => onSaved?.(next || null))
      .catch((e) => {
        toast.error("无法保存说明", e);
        setDraft(saved);
      });
  };

  return (
    <textarea
      ref={ref}
      value={draft}
      rows={1}
      maxLength={2000}
      placeholder="添加说明"
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
      className={cn(
        "block w-full resize-none overflow-hidden rounded-lg bg-transparent px-2 py-1.5 text-sm leading-[22px] text-app-fg outline-none",
        "placeholder:text-app-muted transition-colors duration-fast hover:bg-app-hover/5 focus:bg-app-subtle",
      )}
    />
  );
}

// ─── Rows ───────────────────────────────────────────────────────────────────

function Row({
  icon,
  title,
  sub,
  tip,
  onClick,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  tip?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="flex h-5 w-4 shrink-0 items-center justify-center text-app-muted">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm leading-5">{title}</span>
        {sub && <span className="text-xs leading-[18px] text-app-secondary">{sub}</span>}
      </span>
    </>
  );
  const cls = "flex w-full gap-3 rounded-lg px-2 py-2 text-left";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      data-tip={tip}
      className={cn(cls, "transition-colors duration-fast hover:bg-app-hover/5 active:bg-app-hover/10")}
    >
      {body}
    </button>
  ) : (
    <div className={cls} data-tip={tip}>
      {body}
    </div>
  );
}

/** A line of short facts. `spaced` sets them apart like a camera readout. */
function Facts({ items, status, spaced }: { items: (string | null)[]; status?: MediaPayload["status"]; spaced?: boolean }) {
  const shown = items.filter((x): x is string => !!x);
  return (
    <span className={cn("flex flex-wrap items-center tabular-nums", spaced ? "gap-x-3" : "gap-x-1.5")}>
      {shown.map((t, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {!spaced && i > 0 && <span className="text-app-muted">·</span>}
          {t}
        </span>
      ))}
      {status === "offline" && <span className="text-app-warning">· 离线</span>}
      {status === "missing" && <span className="text-app-danger">· 缺失</span>}
    </span>
  );
}

function TimeRow({ message }: { message: Message }) {
  const media = message.media!;
  if (media.takenAt == null) {
    return <Row icon={<Calendar size={16} />} title={formatFullDateTime(message.createdAt)} sub="导入时间" />;
  }
  const offset = media.takenOffset ?? 0;
  return (
    <Row
      icon={<Calendar size={16} />}
      title={formatTakenTime(media.takenAt, offset)}
      sub={<Facts items={[formatUtcOffset(offset), `导入于 ${dateOnly(message.createdAt)}`]} />}
    />
  );
}

function KindIcon({ media }: { media: MediaPayload }) {
  if (isImageMedia(media)) return <ImageIcon size={16} />;
  if (media.kind === "video") return <Film size={16} />;
  if (media.kind === "audio") return <AudioLines size={16} />;
  return <FileIcon size={16} />;
}

function dateOnly(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function trimZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

function formatCoords(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"}  ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? "E" : "W"}`;
}

/** The dock's preview keeps the picture's shape within portrait 3:4 and 16:9. */
function previewRatio(m: MediaPayload): string {
  if (!m.width || !m.height) return "4 / 3";
  const r = Math.min(16 / 9, Math.max(3 / 4, m.width / m.height));
  return String(r);
}
