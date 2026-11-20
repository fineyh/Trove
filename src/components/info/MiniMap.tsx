import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, Marker, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { thumbSrc } from "../../ipc/client";
import { ATTRIBUTION, styleUrl, tuneStyle } from "../map/mapStyle";

setWorkerUrl(workerUrl);

interface MiniMapProps {
  lib: string;
  lat: number;
  lon: number;
  /** Media whose thumbnail is the pin, as on the map view. */
  mediaId: number;
  hasThumb: boolean;
  dark: boolean;
}

/** Where a photo was taken, on a still map in the info panel (ADR-062). */
export function MiniMap({ lib, lat, lon, mediaId, hasThumb, dark }: MiniMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    setFailed(false);
    const map = new MapLibreMap({
      container,
      style: styleUrl(dark),
      transformStyle: (_previous, next) => tuneStyle(next, dark),
      interactive: false,
      attributionControl: false,
      center: [lon, lat],
      zoom: 12,
      localIdeographFontFamily: '"Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", sans-serif',
    });
    map.on("error", () => setFailed(true));

    const el = document.createElement("div");
    el.className = "map-pin map-pin-mini";
    const card = document.createElement("span");
    card.className = "map-pin-card";
    if (hasThumb) {
      const img = document.createElement("img");
      img.src = thumbSrc(lib, mediaId);
      img.alt = "";
      img.draggable = false;
      card.append(img);
    }
    el.append(card);
    const marker = new Marker({ element: el }).setLngLat([lon, lat]).addTo(map);

    return () => {
      marker.remove();
      map.remove();
    };
  }, [lib, lat, lon, mediaId, hasThumb, dark]);

  return (
    <div className="relative h-[132px] w-full overflow-hidden rounded-lg bg-app-subtle">
      <div ref={ref} className="absolute inset-0" />
      {failed && (
        <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-app-muted">无法加载地图</p>
      )}
      <div className="absolute bottom-1 left-1 flex gap-1 rounded bg-app/70 px-1 text-[10px] leading-4 text-app-muted backdrop-blur-sm">
        {ATTRIBUTION.map((a) => (
          <a key={a.href} href={a.href} onClick={(e) => e.stopPropagation()} className="hover:text-app-fg">
            {a.label}
          </a>
        ))}
      </div>
    </div>
  );
}
