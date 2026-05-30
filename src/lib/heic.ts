// HEIC/HEIF display support.
//
// WebView2 (Chromium) can't decode HEIC/HEIF — patent/licensing — so a native
// `<img src=asset://…>` to a `.heic` file renders as a broken image. We decode
// such files in the browser via `heic-to` (a libheif WASM wrapper) into a JPEG
// blob URL the WebView *can* show.
//
// Cost control:
//   - `heic-to` (and its ~MB of WASM) is **dynamically imported**, so it's only
//     fetched the first time a HEIC actually needs decoding. Normal users /
//     plain JPEG·PNG·video paths never download it.
//   - Decoded blob URLs are cached per absolute path for the session (one decode
//     per file, survives list scroll / re-render). We don't revoke them — the
//     working set is bounded by how many distinct HEICs the user views.
//   - A small concurrency gate keeps a screenful of HEICs from saturating the
//     CPU all at once.
//
// This module stays React-free so the lean `player.html` bundle can import the
// decode primitives without pulling in React. The React hook lives in
// `useDisplayableImageUrl.ts`.

const HEIC_EXT = /\.(heic|heif)$/i;

/** True when the path points at a HEIC/HEIF file (by extension). */
export function isHeicPath(path: string): boolean {
  return HEIC_EXT.test(path);
}

// --- Concurrency gate -------------------------------------------------------

const MAX_CONCURRENT_DECODES = 2;
let active = 0;
const queue: (() => void)[] = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT_DECODES) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function release(): void {
  active--;
  const next = queue.shift();
  if (next) {
    active++;
    next();
  }
}

// --- Decode + cache ---------------------------------------------------------

// Keyed by absolute path. Stores the in-flight/settled promise so concurrent
// callers for the same file dedupe onto one decode.
const cache = new Map<string, Promise<string>>();

async function decode(assetUrl: string): Promise<string> {
  await acquire();
  try {
    const [{ heicTo }, resp] = await Promise.all([
      import("heic-to"),
      fetch(assetUrl),
    ]);
    const blob = await resp.blob();
    const jpeg = await heicTo({ blob, type: "image/jpeg", quality: 0.9 });
    return URL.createObjectURL(jpeg);
  } finally {
    release();
  }
}

/**
 * Decode a HEIC asset URL into a displayable JPEG blob URL. Deduped + cached
 * by `cacheKey` (the original absolute path) for the session.
 */
export function decodeHeicToUrl(cacheKey: string, assetUrl: string): Promise<string> {
  const existing = cache.get(cacheKey);
  if (existing) return existing;
  const p = decode(assetUrl).catch((err) => {
    // Drop failed attempts so a later retry can re-decode.
    cache.delete(cacheKey);
    throw err;
  });
  cache.set(cacheKey, p);
  return p;
}
