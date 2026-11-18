import { useEffect, useRef, useState } from "react";
import { LngLatBounds, Map as MapLibreMap, Marker, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { thumbSrc } from "../../ipc/client";
import type { RecapPlace } from "../../types";
import { ATTRIBUTION, styleUrl, tuneStyle } from "../map/mapStyle";

setWorkerUrl(workerUrl);

/** Pins drawn on the recap's map; the rest still count in the number. */
const PINS = 12;
/** Pins are 52px; closer than this they merge. */
const MERGE_PX = 60;
/** The map frames the largest places holding this share of the items. */
const FRAME_SHARE = 0.85;

/**
 * The places of a recap on a still map: framed once to fit them, no panning.
 * Pins look like the map view's (`.map-pin`), each with how many were there.
 */
export function RecapMap({ lib, places }: { lib: string; places: RecapPlace[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = ref.current;
    if (!container || places.length === 0) return;
    const map = new MapLibreMap({
      container,
      style: styleUrl(true),
      transformStyle: (_previous, next) => tuneStyle(next, true),
      interactive: false,
      attributionControl: false,
      center: [places[0].lon, places[0].lat],
      zoom: 4,
      localIdeographFontFamily: '"Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", sans-serif',
    });
    map.on("error", () => setFailed(true));
    map.on("sourcedata", (e) => {
      if (e.tile) setFailed(false);
    });

    // Framed on where most of it happened: one far trip would otherwise
    // zoom the map out until everything else is a single pin.
    const all = places.reduce((s, p) => s + p.count, 0);
    const bounds = new LngLatBounds();
    let seen = 0;
    for (const p of places) {
      if (seen >= all * FRAME_SHARE && bounds.getNorthEast()) break;
      bounds.extend([p.lon, p.lat]);
      seen += p.count;
    }
    map.fitBounds(bounds, { padding: 64, maxZoom: 11, duration: 0 });

    // Places that would cover each other on screen become one pin: the
    // largest stands for them and the count adds up.
    const groups: { p: RecapPlace; x: number; y: number; count: number }[] = [];
    for (const p of places) {
      const { x, y } = map.project([p.lon, p.lat]);
      const near = groups.find((g) => Math.hypot(g.x - x, g.y - y) < MERGE_PX);
      if (near) near.count += p.count;
      else groups.push({ p, x, y, count: p.count });
    }
    // Largest last, so it sits on top where pins touch.
    const markers = groups
      .slice(0, PINS)
      .reverse()
      .map(({ p, count }) => {
        const el = document.createElement("div");
        el.className = "map-pin";
        const card = document.createElement("span");
        card.className = "map-pin-card";
        if (p.cover) {
          const img = document.createElement("img");
          img.src = thumbSrc(lib, p.cover.mediaId);
          img.alt = "";
          img.draggable = false;
          card.append(img);
        }
        el.append(card);
        if (count > 1) {
          const badge = document.createElement("span");
          badge.className = "map-pin-count";
          badge.textContent = count > 999 ? "999+" : String(count);
          el.append(badge);
        }
        return new Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
      });

    return () => {
      for (const m of markers) m.remove();
      map.remove();
    };
  }, [lib, places]);

  return (
    <div className="relative aspect-[4/3] max-h-[calc(100vh-200px)] w-full overflow-hidden rounded-2xl bg-app-subtle ring-1 ring-app-hover/10">
      <div ref={ref} className="absolute inset-0" />
      {failed && (
        <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-app-muted">无法加载地图</p>
      )}
      <div className="absolute bottom-1.5 left-1.5 flex gap-1.5 rounded-md bg-app/70 px-1.5 text-2xs leading-[18px] text-app-muted backdrop-blur-sm">
        {ATTRIBUTION.map((a) => (
          <a key={a.href} href={a.href} className="hover:text-app-fg">
            {a.label}
          </a>
        ))}
      </div>
    </div>
  );
}
