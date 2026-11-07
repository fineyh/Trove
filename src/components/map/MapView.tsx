import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { ArrowLeft, CloudOff, ImageOff, Loader2, MapPin, Play, X } from "lucide-react";
import { IconButton } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { useSessionStore } from "../../stores/session";
import { useMessagesStore } from "../../stores/messages";
import { currentLib, stillOn, useCurrentLibrary } from "../../stores/libraries";
import { useSettingsStore } from "../../stores/settings";
import { useThumbUrl } from "../../stores/thumbs";
import {
  backfillGeotags,
  listGeotaggedMedia,
  mediaSrc,
  onGeoBackfillDone,
} from "../../ipc/client";
import type { GeotaggedMedia } from "../../types";
import { isHeicExt } from "../../lib/heic";
import { isImageMedia } from "../../lib/media";
import { MapPhotoViewer } from "./MapPhotoViewer";

export function MapView() {
  const open = useSessionStore((s) => s.mapOpen);
  // Mount the Leaflet machinery only while open so init/teardown tracks the
  // overlay lifecycle (and the map isn't running in the background).
  if (!open) return null;
  return <MapOverlay />;
}

interface LocationGroup {
  key: string;
  lat: number;
  lon: number;
  items: GeotaggedMedia[];
}

/** Bucket media by coordinate (~1m precision) so one marker = one place. */
function groupByLocation(media: GeotaggedMedia[]): LocationGroup[] {
  const buckets = new Map<string, LocationGroup>();
  for (const m of media) {
    const key = `${m.lat.toFixed(5)},${m.lon.toFixed(5)}`;
    let g = buckets.get(key);
    if (!g) {
      g = { key, lat: m.lat, lon: m.lon, items: [] };
      buckets.set(key, g);
    }
    g.items.push(m);
  }
  return [...buckets.values()];
}

/** Self-contained (inline-styled) marker so Tailwind/bundler asset issues with
 * Leaflet's default PNG icon never apply. Accent color comes from the CSS var. */
function markerIcon(count: number): L.DivIcon {
  const html =
    count > 1
      ? `<div style="display:flex;align-items:center;justify-content:center;min-width:30px;height:30px;padding:0 7px;border-radius:15px;background:rgb(var(--accent));color:rgb(var(--on-accent));font-size:12px;font-weight:600;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)">${count}</div>`
      : `<div style="width:18px;height:18px;border-radius:50%;background:rgb(var(--accent));border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>`;
  const size = count > 1 ? 30 : 18;
  return L.divIcon({
    html,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function MapOverlay() {
  const setMapOpen = useSessionStore((s) => s.setMapOpen);
  const setActiveConversation = useSessionStore((s) => s.setActiveConversation);
  const openLightbox = useSessionStore((s) => s.openLightbox);
  const tilesOn = useSettingsStore((s) => s.settings.mapTiles === "online");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const fittedRef = useRef(false);

  const [media, setMedia] = useState<GeotaggedMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<GeotaggedMedia[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // Load existing geotags, kick off a (lazy, idempotent) backfill for older
  // media, and re-fetch when the backfill reports new coordinates.
  useEffect(() => {
    let cancelled = false;
    // The map shows the current library only (ADR-038): a locked library's
    // places can't surface here, and switching library re-mounts this.
    const libId = currentLib();
    setLoading(true);
    listGeotaggedMedia(libId)
      .then((m) => {
        if (!cancelled && stillOn(libId)) {
          setMedia(m);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    void backfillGeotags(libId);

    let unlisten: (() => void) | null = null;
    void onGeoBackfillDone(({ lib: l, updated }) => {
      if (cancelled || updated <= 0 || l !== libId) return;
      void listGeotaggedMedia(libId).then((m) => {
        if (!cancelled && stillOn(libId)) setMedia(m);
      });
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Initialize the Leaflet map once. The guard + cleanup make this safe under
  // React StrictMode's double-invoke (cleanup runs `map.remove()` between).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([20, 0], 2);
    // Online tiles tell the tile server which areas you look at — i.e. where
    // your photos were taken. Off = markers on a blank canvas.
    if (tilesOn) {
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
    }
    const cluster = L.markerClusterGroup({ chunkedLoading: true });
    map.addLayer(cluster);
    mapRef.current = map;
    clusterRef.current = cluster;
    // Container is laid out via `absolute inset-0`; nudge Leaflet to measure it.
    setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      fittedRef.current = false;
    };
  }, [tilesOn]);

  // (Re)build markers whenever the media set changes.
  useEffect(() => {
    const cluster = clusterRef.current;
    const map = mapRef.current;
    if (!cluster || !map) return;
    cluster.clearLayers();
    const groups = groupByLocation(media);
    const markers = groups.map((g) => {
      const marker = L.marker([g.lat, g.lon], { icon: markerIcon(g.items.length) });
      marker.on("click", () => {
        setViewerIndex(null);
        setSelected(g.items);
      });
      return marker;
    });
    cluster.addLayers(markers);
    // Fit to all points once on first load; don't yank the view afterwards.
    if (!fittedRef.current && groups.length > 0) {
      const bounds = L.latLngBounds(
        groups.map((g) => [g.lat, g.lon] as [number, number]),
      );
      map.fitBounds(bounds.pad(0.2), { maxZoom: 14 });
      fittedRef.current = true;
    }
  }, [media]);

  const handleJump = (item: GeotaggedMedia) => {
    setViewerIndex(null);
    setSelected(null);
    setMapOpen(false);
    setActiveConversation(item.convId);
    void useMessagesStore.getState().load(item.convId);
    openLightbox(item.messageId);
  };

  return (
    <div className="fixed inset-y-0 left-16 right-0 z-40 flex flex-col border-l border-app-border bg-app-panel">
      <div
        data-drag-region
        className="flex h-[52px] shrink-0 items-center gap-2 border-b border-app-border pl-2.5 pr-[calc(var(--wc-width)+10px)]"
      >
        {/* Back, on the left: an X here would sit right beside the window's close. */}
        <IconButton label="返回会话" icon={<ArrowLeft size={18} />} onClick={() => setMapOpen(false)} />
        <span className="text-base font-semibold">地图</span>
        {!loading && <span className="text-xs text-app-muted">{media.length.toLocaleString()} 个有位置的文件</span>}
      </div>

      {/* `isolate` traps Leaflet's internal z-indexes (panes z200–700, controls
          z1000) inside this stacking context, so the fullscreen photo viewer
          (a sibling below) reliably paints above the whole map. */}
      <div className="relative isolate flex-1">
        <div ref={containerRef} className="absolute inset-0" />

        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Loader2 size={28} className="animate-spin text-app-muted" />
          </div>
        )}

        {!loading && media.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <EmptyState icon={<MapPin size={32} strokeWidth={1.5} />} title="没有带位置信息的照片或视频" />
          </div>
        )}

        {!tilesOn && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] flex items-center gap-1.5 rounded-lg bg-app-panel/90 px-2.5 py-1 text-xs text-app-muted shadow-md ring-1 ring-app-border backdrop-blur">
            <CloudOff size={12} />
            在线底图已关闭
          </div>
        )}

        {selected && (
          <MapSidePanel
            items={selected}
            onClose={() => setSelected(null)}
            onOpen={(i) => setViewerIndex(i)}
          />
        )}
      </div>

      {viewerIndex !== null && selected && (
        <MapPhotoViewer
          items={selected}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onIndexChange={setViewerIndex}
          onJump={handleJump}
        />
      )}
    </div>
  );
}

function MapSidePanel({
  items,
  onClose,
  onOpen,
}: {
  items: GeotaggedMedia[];
  onClose: () => void;
  onOpen: (index: number) => void;
}) {
  return (
    <div className="absolute right-0 top-0 z-[1000] flex h-full w-[320px] animate-slide-in-right flex-col border-l border-app-border bg-app-panel">
      <div className="flex h-12 shrink-0 items-center gap-1 pl-4 pr-2.5">
        <span className="flex-1 text-sm font-semibold">这里的 {items.length.toLocaleString()} 个文件</span>
        <IconButton label="关闭" size="sm" icon={<X size={16} />} onClick={onClose} />
      </div>
      <div className="grid flex-1 grid-cols-3 content-start gap-1 overflow-y-auto px-4 pb-4">
        {items.map((m, i) => (
          <MapThumb key={m.mediaId} item={m} onClick={() => onOpen(i)} />
        ))}
      </div>
    </div>
  );
}

function MapThumb({
  item,
  onClick,
}: {
  item: GeotaggedMedia;
  onClick: () => void;
}) {
  const lib = useCurrentLibrary()?.id ?? null;
  const thumb = useThumbUrl(lib, { id: item.mediaId, hasThumb: item.hasThumb });
  const isImage = isImageMedia(item);
  const fallback =
    !thumb && isImage && !isHeicExt(item.ext) && lib && item.status === "ok"
      ? mediaSrc(lib, item.mediaId)
      : null;
  const src = thumb ?? fallback;
  const reachable = item.status === "ok";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!reachable && !src}
      data-tip={item.status === "offline" ? "离线" : item.status === "missing" ? "缺失" : undefined}
      className="relative aspect-square overflow-hidden rounded-md bg-app-subtle"
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          className={"h-full w-full object-cover transition-opacity duration-fast hover:opacity-90" + (reachable ? "" : " opacity-60 grayscale")}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-app-muted">
          {reachable ? <Loader2 size={16} className="animate-spin" /> : <ImageOff size={18} />}
        </span>
      )}
      {item.kind === "video" && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white">
            <Play size={12} fill="currentColor" />
          </span>
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
