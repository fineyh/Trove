import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { LngLatBounds, Map as MapLibreMap, Marker, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import Supercluster from "supercluster";
import { thumbSrc } from "../../ipc/client";
import { useThumbsStore } from "../../stores/thumbs";
import type { GeotaggedMedia } from "../../types";
import { styleUrl, tuneStyle } from "./mapStyle";

// The worker ships as its own file; the bundler has to be told where it is.
setWorkerUrl(workerUrl);

/** Stacks merge when their pins (52px) would overlap. */
const CLUSTER_RADIUS = 60;
const MAX_ZOOM = 19;
/** Where each library's map was last left, for this run of the app. */
const cameras = new Map<string, { center: [number, number]; zoom: number }>();

export interface MapSelection {
  /** Media id of the stack's cover (its newest item). */
  anchor: number;
  count: number;
}

export interface MapCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fitAll: () => void;
  /** Go to one item and select the stack it sits in. */
  focus: (item: GeotaggedMedia) => void;
}

interface MapCanvasProps {
  lib: string;
  /** Newest first. */
  items: GeotaggedMedia[];
  dark: boolean;
  selection: MapSelection | null;
  onSelect: (items: GeotaggedMedia[], anchor: number) => void;
  /** Click on the bare map. */
  onClear: () => void;
  /** Items inside the visible area, newest first, after each move. */
  onView: (items: GeotaggedMedia[]) => void;
  onBasemapError: (failed: boolean) => void;
}

interface PointProps {
  /** Index into `items`. */
  i: number;
}
interface StackProps {
  /** Index of the newest item in the stack: its cover. */
  top: number;
  topAt: number;
}

interface Pin {
  marker: Marker;
  el: HTMLButtonElement;
  img: HTMLImageElement | null;
  badge: HTMLSpanElement;
  top: number;
  count: number;
  clusterId: number | null;
  src: string | null;
}

const PLACEHOLDER =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>';
const PLAY =
  '<svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/></svg>';

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas(
  { lib, items, dark, selection, onSelect, onClear, onView, onBasemapError },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const indexRef = useRef<Supercluster<PointProps, StackProps> | null>(null);
  const pinsRef = useRef(new Map<number, Pin>());
  const frameRef = useRef(0);
  const fittedRef = useRef(cameras.has(lib));

  // Latest props for the long-lived map callbacks.
  const live = useRef({ items, dark, selection, onSelect, onClear, onView, onBasemapError });
  live.current = { items, dark, selection, onSelect, onClear, onView, onBasemapError };

  /** Everything in a pin's stack, newest first. */
  const leavesOf = (pin: Pin): GeotaggedMedia[] => {
    const { items } = live.current;
    const index = indexRef.current;
    if (pin.clusterId === null || !index) return [items[pin.top]];
    return index
      .getLeaves(pin.clusterId, Infinity)
      .map((f) => f.properties.i)
      .sort((a, b) => a - b) // `items` is newest first, so index order is date order
      .map((i) => items[i]);
  };

  const makePin = (map: MapLibreMap, key: number): Pin => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "map-pin";
    const card = document.createElement("span");
    card.className = "map-pin-card";
    const badge = document.createElement("span");
    badge.className = "map-pin-count";
    el.append(card, badge);

    const pin: Pin = {
      marker: new Marker({ element: el }),
      el,
      img: null,
      badge,
      top: -1,
      count: 0,
      clusterId: null,
      src: null,
    };

    // Dragging the map by a pin ends in a click on that pin; tell them apart.
    let downAt: [number, number] | null = null;
    el.addEventListener("pointerdown", (e) => (downAt = [e.clientX, e.clientY]));
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
      live.current.onSelect(leavesOf(pin), key);
    });
    // Double-click opens the stack up: zoom to where it splits. The first
    // click of the pair selected it; the list goes back to following the view.
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      e.preventDefault();
      live.current.onClear();
      const index = indexRef.current;
      const at = pin.marker.getLngLat();
      const zoom =
        pin.clusterId !== null && index
          ? Math.min(index.getClusterExpansionZoom(pin.clusterId), MAX_ZOOM)
          : Math.min(map.getZoom() + 2, MAX_ZOOM);
      map.easeTo({ center: at, zoom: Math.max(zoom, map.getZoom() + 1), duration: 400 });
    });
    return pin;
  };

  /** Bring the pins in line with the stacks at the current view. */
  const sync = () => {
    const map = mapRef.current;
    const index = indexRef.current;
    if (!map || !index) return;
    const { items, selection } = live.current;
    const pins = pinsRef.current;
    const fresh = useThumbsStore.getState().fresh;

    const b = map.getBounds();
    const w = b.getWest();
    const e = b.getEast();
    // A margin so pins half outside the edge don't pop in and out.
    const padLng = ((e - w) / Math.max(1, map.getContainer().clientWidth)) * 40;
    const padLat = ((b.getNorth() - b.getSouth()) / Math.max(1, map.getContainer().clientHeight)) * 40;
    const bbox: [number, number, number, number] =
      e - w + 2 * padLng >= 360
        ? [-180, -85, 180, 85]
        : [w - padLng, Math.max(-85, b.getSouth() - padLat), e + padLng, Math.min(85, b.getNorth() + padLat)];

    const seen = new Set<number>();
    for (const f of index.getClusters(bbox, Math.floor(map.getZoom()))) {
      const p = f.properties as Partial<PointProps> & Partial<StackProps> & { cluster?: boolean; cluster_id?: number; point_count?: number };
      const top = p.cluster ? p.top! : p.i!;
      const count = p.cluster ? p.point_count! : 1;
      const item = items[top];
      if (!item) continue;
      const key = item.mediaId;
      seen.add(key);

      let pin = pins.get(key);
      const isNew = !pin;
      if (!pin) {
        pin = makePin(map, key);
        pins.set(key, pin);
      }
      pin.top = top;
      pin.clusterId = p.cluster ? p.cluster_id! : null;
      pin.marker.setLngLat(f.geometry.coordinates as [number, number]);

      if (pin.count !== count) {
        pin.count = count;
        pin.badge.textContent = count > 1 ? formatCount(count) : "";
        pin.el.classList.toggle("is-stack", count > 1);
        pin.el.setAttribute("aria-label", count > 1 ? `${count} 个文件` : "1 个文件");
        // Bigger stacks sit on top where pins touch.
        pin.el.style.zIndex = String(Math.min(count, 999));
      }

      const src = item.hasThumb || fresh[`${lib}:${key}`] ? thumbSrc(lib, key) : null;
      if (isNew || pin.src !== src) {
        pin.src = src;
        const card = pin.el.firstElementChild as HTMLElement;
        if (src) {
          const img = document.createElement("img");
          img.alt = "";
          img.draggable = false;
          img.src = src;
          card.replaceChildren(img);
          pin.img = img;
        } else {
          card.innerHTML = PLACEHOLDER;
          pin.img = null;
        }
        if (item.kind === "video") {
          const play = document.createElement("span");
          play.className = "map-pin-play";
          play.innerHTML = PLAY;
          card.append(play);
        }
        pin.el.classList.toggle("is-dim", item.status !== "ok");
      }

      pin.el.classList.toggle("is-selected", selection !== null && selection.anchor === key && selection.count === count);
      if (isNew) pin.marker.addTo(map);
    }

    for (const [key, pin] of pins) {
      if (!seen.has(key)) {
        pin.marker.remove();
        pins.delete(key);
      }
    }
  };

  const scheduleSync = () => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      sync();
    });
  };

  const emitView = () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const w = b.getWest();
    const span = b.getEast() - w;
    const s = b.getSouth();
    const n = b.getNorth();
    const { items, onView } = live.current;
    onView(
      span >= 360
        ? items.filter((m) => m.lat >= s && m.lat <= n)
        : items.filter((m) => {
            if (m.lat < s || m.lat > n) return false;
            // The view can run past ±180; measure longitude from its west edge.
            const d = (((m.lon - w) % 360) + 360) % 360;
            return d <= span;
          }),
    );
  };

  const fitAll = (animate: boolean) => {
    const map = mapRef.current;
    const { items } = live.current;
    if (!map || items.length === 0) return;
    const bounds = new LngLatBounds();
    for (const m of items) bounds.extend([m.lon, m.lat]);
    map.fitBounds(bounds, { padding: 72, maxZoom: 14, animate, duration: 600 });
  };

  useImperativeHandle(ref, () => ({
    zoomIn: () => mapRef.current?.zoomIn({ duration: 240 }),
    zoomOut: () => mapRef.current?.zoomOut({ duration: 240 }),
    fitAll: () => fitAll(true),
    focus: (item) => {
      const map = mapRef.current;
      if (!map) return;
      map.jumpTo({ center: [item.lon, item.lat], zoom: Math.max(map.getZoom(), 15) });
      fittedRef.current = true;
      sync();
      for (const [key, pin] of pinsRef.current) {
        const leaves = leavesOf(pin);
        if (leaves.some((m) => m.mediaId === item.mediaId)) {
          live.current.onSelect(leaves, key);
          return;
        }
      }
    },
  }));

  // The map itself, once per mount (the overlay remounts per library).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const camera = cameras.get(lib);
    const map = new MapLibreMap({
      container,
      style: styleUrl(dark),
      // Kept for later setStyle calls too, hence reading the theme live.
      transformStyle: (_previous, next) => tuneStyle(next, live.current.dark),
      center: camera?.center ?? [105, 32],
      zoom: camera?.zoom ?? 2.4,
      minZoom: 1.5,
      maxZoom: MAX_ZOOM,
      maxPitch: 0,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      // CJK labels drawn with a system font instead of fetched glyph ranges.
      localIdeographFontFamily: '"Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", sans-serif',
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    mapRef.current = map;

    map.on("move", scheduleSync);
    map.on("moveend", () => {
      const c = map.getCenter();
      cameras.set(lib, { center: [c.lng, c.lat], zoom: map.getZoom() });
      emitView();
    });
    map.on("click", (e) => {
      if ((e.originalEvent.target as HTMLElement | null)?.closest?.(".map-pin")) return;
      live.current.onClear();
    });
    // Offline, or the tile host is unreachable: say so instead of a bare canvas.
    map.on("error", () => live.current.onBasemapError(true));
    map.on("sourcedata", (e) => {
      if (e.tile) live.current.onBasemapError(false);
    });

    sync();
    emitView();
    const unsubscribe = useThumbsStore.subscribe(scheduleSync);

    return () => {
      unsubscribe();
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      for (const pin of pinsRef.current.values()) pin.marker.remove();
      pinsRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
    // `dark` only picks the first style; the effect below follows changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib]);

  // Follow the app theme.
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    mapRef.current?.setStyle(styleUrl(dark));
  }, [dark]);

  // (Re)build the stacks when the media set changes.
  useEffect(() => {
    const index = new Supercluster<PointProps, StackProps>({
      radius: CLUSTER_RADIUS,
      // Past the map's own limit: items at one spot stay one stack, however far in.
      maxZoom: MAX_ZOOM + 1,
      map: (p) => ({ top: p.i, topAt: items[p.i].createdAt }),
      reduce: (acc, p) => {
        if (p.topAt > acc.topAt || (p.topAt === acc.topAt && p.top < acc.top)) {
          acc.top = p.top;
          acc.topAt = p.topAt;
        }
      },
    });
    index.load(
      items.map((m, i) => ({
        type: "Feature" as const,
        properties: { i },
        geometry: { type: "Point" as const, coordinates: [m.lon, m.lat] },
      })),
    );
    indexRef.current = index;
    // Old pins point at cluster ids of the previous index.
    for (const pin of pinsRef.current.values()) pin.marker.remove();
    pinsRef.current.clear();

    if (!fittedRef.current && items.length > 0) {
      fittedRef.current = true;
      fitAll(false);
    }
    sync();
    emitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  // MapLibre's stylesheet makes its container `position: relative`, so the
  // sizing sits on a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
});
