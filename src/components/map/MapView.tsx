import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { ImageOff, Loader2, MapPin, Play, X } from "lucide-react";
import { useSessionStore } from "../../stores/session";
import { useMessagesStore } from "../../stores/messages";
import {
  backfillGeotags,
  listGeotaggedMedia,
  mediaUrl,
  onGeoBackfillDone,
} from "../../ipc/client";
import type { GeotaggedMedia } from "../../types";
import { isHeicPath } from "../../lib/heic";
import { useDisplayableImageUrl } from "../../lib/useDisplayableImageUrl";
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
    setLoading(true);
    listGeotaggedMedia()
      .then((m) => {
        if (!cancelled) {
          setMedia(m);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    void backfillGeotags();

    let unlisten: (() => void) | null = null;
    void onGeoBackfillDone((updated) => {
      if (cancelled || updated <= 0) return;
      void listGeotaggedMedia().then((m) => {
        if (!cancelled) setMedia(m);
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
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
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
  }, []);

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
    <div className="fixed inset-y-0 right-0 left-16 z-40 flex flex-col bg-app">
      <div className="flex items-center justify-between border-b border-app-border bg-app-panel px-4 py-2">
        <div className="flex items-center gap-2 text-app-fg">
          <MapPin size={18} />
          <span className="font-medium">地图</span>
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

      <div className="relative flex-1">
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

        <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-md bg-app-panel/90 px-2.5 py-1.5 text-xs text-app-muted shadow">
          底图来自 OpenStreetMap · 需联网
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
  const isImage = item.kind === "image" || isHeicPath(item.absolutePath);
  // Hook must run unconditionally; for video the path isn't HEIC so it resolves
  // to the asset URL immediately and goes unused.
  const image = useDisplayableImageUrl(item.absolutePath, mediaUrl(item.absolutePath));
  const url = mediaUrl(item.absolutePath);

  if (!item.available) {
    return (
      <div
        title="文件暂时不可用"
        className="flex aspect-square items-center justify-center rounded-md border border-dashed border-app-border bg-app-subtle/40 text-app-muted"
      >
        <ImageOff size={18} />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-square overflow-hidden rounded-md bg-black/5"
    >
      {isImage ? (
        image.status === "error" ? (
          <span className="flex h-full w-full items-center justify-center text-app-muted">
            <ImageOff size={18} />
          </span>
        ) : image.status === "loading" || !image.url ? (
          <span className="flex h-full w-full items-center justify-center bg-app-subtle/40 text-app-muted">
            <Loader2 size={16} className="animate-spin" />
          </span>
        ) : (
          <img src={image.url} className="h-full w-full object-cover" alt="" />
        )
      ) : (
        <>
          <video
            src={url}
            preload="metadata"
            muted
            className="h-full w-full object-cover"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white">
            <Play size={18} fill="currentColor" />
          </span>
        </>
      )}
    </button>
  );
}
