import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { CloudOff, ImageOff, Loader2, MapPin, Play, X } from "lucide-react";
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
      ? `<div style="display:flex;align-items:center;justify-content:center;min-width:30px;height:30px;padding:0 7px;border-radius:15px;background:rgb(var(--color-accent));color:#fff;font-size:12px;font-weight:600;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)">${count}</div>`
      : `<div style="width:18px;height:18px;border-radius:50%;background:rgb(var(--color-accent));border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>`;
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
  const lib = useCurrentLibrary();
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
    <div className="fixed inset-y-0 left-[68px] right-0 z-40 flex flex-col bg-app">
      <div className="flex items-center justify-between border-b border-app-border bg-app-panel px-4 py-2">
        <div className="flex items-center gap-2 text-app-fg">
          <MapPin size={18} />
          <span className="font-medium">地图</span>
          {lib && <span className="text-sm text-app-muted">· {lib.name}</span>}
          {!loading && (
            <span className="text-sm text-app-muted">
              {media.length} 张带位置的照片
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setMapOpen(false)}
          className="flex h-8 w-8 items-center justify-center rounded text-app-muted hover:bg-app-subtle"
          aria-label="关闭"
        >
          <X size={18} />
        </button>
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
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-app-muted">
            <MapPin size={32} />
            <p className="text-sm">还没有带 GPS 位置的照片或视频</p>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] flex items-center gap-1.5 rounded-lg bg-app-panel/90 px-2.5 py-1.5 text-xs text-app-muted shadow backdrop-blur">
          {tilesOn ? (
            "底图来自 OpenStreetMap · 需联网"
          ) : (
            <>
              <CloudOff size={12} />
              在线底图已关闭，可在「设置 → 通用」里打开
            </>
          )}
        </div>

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
    <div className="absolute right-0 top-0 z-[1000] flex h-full w-[340px] flex-col border-l border-app-border bg-app-panel shadow-xl">
      <div className="flex items-center justify-between border-b border-app-border px-3 py-2">
        <span className="text-sm font-medium text-app-fg">
          此地点 · {items.length} 张
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded text-app-muted hover:bg-app-subtle"
          aria-label="关闭"
        >
          <X size={16} />
        </button>
      </div>
      <div className="grid flex-1 grid-cols-3 content-start gap-1.5 overflow-y-auto p-3">
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
      title={item.status === "offline" ? "所在的盘没有连接" : item.status === "missing" ? "文件不在原位置" : undefined}
      className="group relative aspect-square overflow-hidden rounded-lg bg-app-subtle"
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          className={"h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" + (reachable ? "" : " opacity-60 grayscale")}
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
