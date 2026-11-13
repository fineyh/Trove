// The basemap: OpenFreeMap's hosted vector styles (ADR-049). The style JSON is
// fetched at runtime so it keeps tracking their tile / sprite / glyph URLs;
// `tuneStyle` then adjusts it for this app: Chinese place names, and colours
// pulled toward the app's own neutrals so the map sits quietly under the photos.

import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";

const STYLES = "https://tiles.openfreemap.org/styles";

export function styleUrl(dark: boolean): string {
  return `${STYLES}/${dark ? "dark" : "positron"}`;
}

/** Simplified Chinese where the tiles carry it, else the place's own name. */
const NAME_ZH: ExpressionSpecification = ["coalesce", ["get", "name:zh-Hans"], ["get", "name:zh"], ["get", "name"]];

type Paint = Record<string, unknown>;

/** Paint overrides by layer id. An id the upstream style drops is simply skipped. */
const LIGHT: Record<string, Paint> = {
  background: { "background-color": "rgb(245,246,248)" },
  water: { "fill-color": "rgb(212,221,238)" },
  waterway: { "line-color": "rgb(212,221,238)" },
  park: { "fill-color": "rgb(226,235,227)" },
  landcover_wood: { "fill-color": "rgb(220,231,222)" },
  landuse_residential: { "fill-color": "rgb(239,240,243)" },
  building: { "fill-color": "rgb(234,236,240)", "fill-outline-color": "rgb(221,224,230)" },
  road_area_pier: { "fill-color": "rgb(245,246,248)" },
  road_pier: { "line-color": "rgb(245,246,248)" },
  // Road outlines a step quieter: at region zooms they otherwise read as a mesh.
  highway_major_casing: { "line-color": "rgb(224,226,232)" },
  highway_motorway_casing: { "line-color": "rgb(218,221,228)" },
  highway_motorway_bridge_casing: { "line-color": "rgb(218,221,228)" },
  tunnel_motorway_casing: { "line-color": "rgb(224,226,232)" },
  highway_minor: { "line-color": "rgb(232,234,239)" },
  boundary_2: { "line-color": "rgb(176,181,194)" },
  boundary_3: { "line-color": "rgb(196,200,211)" },
  boundary_disputed: { "line-color": "rgb(176,181,194)" },
};

const DARK: Record<string, Paint> = {
  background: { "background-color": "rgb(37,40,48)" },
  water: { "fill-color": "rgb(20,23,32)" },
  waterway: { "line-color": "rgb(20,23,32)" },
  landcover_ice_shelf: { "fill-color": "rgb(48,51,60)" },
  landcover_glacier: { "fill-color": "rgb(48,51,60)" },
  landuse_residential: { "fill-color": "rgb(40,43,52)" },
  landcover_wood: { "fill-color": "rgb(33,44,42)" },
  landuse_park: { "fill-color": "rgb(33,44,42)" },
  building: { "fill-color": "rgb(44,47,57)", "fill-outline-color": "rgb(52,56,66)" },
  road_area_pier: { "fill-color": "rgb(37,40,48)" },
  road_pier: { "line-color": "rgb(37,40,48)" },
  "aeroway-area": { "fill-color": "rgb(31,33,40)" },
  "aeroway-runway": { "line-color": "rgb(31,33,40)" },
  "aeroway-taxiway": { "line-color": "rgb(31,33,40)" },
  highway_path: { "line-color": "rgb(47,50,60)" },
  highway_minor: { "line-color": "rgb(47,50,60)" },
  highway_major_inner: { "line-color": "rgb(56,60,71)" },
  highway_major_casing: { "line-color": "rgb(28,30,37)" },
  highway_major_subtle: { "line-color": "rgb(52,56,66)" },
  highway_motorway_inner: { "line-color": "rgb(64,68,81)" },
  highway_motorway_casing: { "line-color": "rgb(28,30,37)" },
  highway_motorway_subtle: { "line-color": "rgb(52,56,66)" },
  railway: { "line-color": "rgb(52,56,66)" },
  railway_minor: { "line-color": "rgb(52,56,66)" },
  railway_transit: { "line-color": "rgb(52,56,66)" },
  railway_dashline: { "line-color": "rgb(37,40,48)" },
  railway_minor_dashline: { "line-color": "rgb(37,40,48)" },
  railway_transit_dashline: { "line-color": "rgb(37,40,48)" },
  boundary_state: { "line-color": "rgb(62,66,78)" },
  "boundary_country_z0-4": { "line-color": "rgb(82,87,102)" },
  "boundary_country_z5-": { "line-color": "rgb(82,87,102)" },
  water_name: { "text-color": "rgb(98,110,144)", "text-halo-color": "rgba(20,23,32,0.8)" },
  highway_name_other: { "text-color": "rgb(128,133,144)", "text-halo-color": "rgba(37,40,48,0.9)" },
  highway_name_motorway: { "text-color": "rgb(128,133,144)" },
};

/** Place names: the app's text colours instead of pure black / dim grey. */
function placeLabel(id: string, dark: boolean): Paint | null {
  if (!/^(label|place)_/.test(id)) return null;
  const minor = /_(other|suburb|state|village)$/.test(id);
  if (dark) {
    return {
      "text-color": minor ? "rgb(134,139,150)" : "rgb(190,194,203)",
      "text-halo-color": "rgba(24,26,32,0.85)",
    };
  }
  return {
    "text-color": minor ? "rgb(92,97,107)" : "rgb(34,37,44)",
    "text-halo-color": "rgba(255,255,255,0.85)",
  };
}

export function tuneStyle(style: StyleSpecification, dark: boolean): StyleSpecification {
  const overrides = dark ? DARK : LIGHT;
  // Road numbers (shields, or bare "E88;1" in the dark style) are noise under photos.
  const kept = style.layers.filter((layer) => {
    if (layer.type !== "symbol") return true;
    const field = layer.layout?.["text-field"];
    return !(field && JSON.stringify(field).includes('"ref"'));
  });
  const layers = kept.map((layer) => {
    const paint = { ...overrides[layer.id], ...placeLabel(layer.id, dark) };
    let next = Object.keys(paint).length > 0 ? { ...layer, paint: { ...layer.paint, ...paint } } : layer;

    if (next.type === "symbol") {
      const field = next.layout?.["text-field"];
      if (field && JSON.stringify(field).includes("name")) {
        next = { ...next, layout: { ...next.layout, "text-field": NAME_ZH } };
      }
    }
    return next as typeof layer;
  });

  // Sources no layer draws would still be fetched.
  const used = new Set<string>();
  for (const l of layers) if ("source" in l && typeof l.source === "string") used.add(l.source);
  const sources = Object.fromEntries(Object.entries(style.sources).filter(([id]) => used.has(id)));

  return { ...style, layers, sources };
}

export const ATTRIBUTION = [
  { label: "© OpenStreetMap", href: "https://www.openstreetmap.org/copyright" },
  { label: "OpenMapTiles", href: "https://openmaptiles.org/" },
  { label: "OpenFreeMap", href: "https://openfreemap.org/" },
];
