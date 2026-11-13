import { lazy, Suspense } from "react";
import { useLibrariesStore } from "../../stores/libraries";
import { useSessionStore } from "../../stores/session";
import { useSettingsStore } from "../../stores/settings";

// The map engine is large and only needed here: its own chunk, fetched on
// first open.
const MapOverlay = lazy(() => import("./MapOverlay"));

/** The map is either on or off (settings): off means no map at all, not a
 *  map without a basemap. */
export function useMapEnabled(): boolean {
  return useSettingsStore((s) => s.settings.mapTiles === "online");
}

export function MapView() {
  const open = useSessionStore((s) => s.mapOpen);
  const enabled = useMapEnabled();
  const lib = useLibrariesStore((s) => s.current);
  if (!open || !enabled || lib === null) return null;
  // Keyed by library: switching stays on the map but shows the other
  // library's places, with nothing carried over (ids are per library).
  return (
    <Suspense fallback={null}>
      <MapOverlay key={lib} lib={lib} />
    </Suspense>
  );
}
