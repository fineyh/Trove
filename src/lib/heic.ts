// HEIC/HEIF display support.
//
// WebView2 (Chromium) can't decode HEIC/HEIF — patent/licensing — so we decode
// such files in the browser via `heic-to` (a libheif WASM wrapper) into a JPEG
// blob the WebView *can* show.
//
// Cost control:
//   - `heic-to` (and its ~MB of WASM) is **dynamically imported**, so it's only
//     fetched the first time a HEIC actually needs decoding. We use its `csp`
//     build: the default one evals, which the CSP forbids.
//   - Decoded blob URLs are kept in a small LRU and revoked on eviction. The
//     chat and grids show stored thumbnails (ADR-037), so only the full-size
//     viewers come through here and a handful of entries is plenty.
//   - A small concurrency gate keeps several decodes from saturating the CPU.
//
// This module stays React-free so the lean `player.html` bundle can import the
// decode primitives without pulling in React. The React hook lives in
// `useDisplayableImageUrl.ts`.

/** True for HEIC/HEIF by (lower-case, dot-less) extension. */
export function isHeicExt(ext: string | null | undefined): boolean {
  return ext === "heic" || ext === "heif";
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

/** Decode a HEIC blob into a JPEG blob. */
export async function heicToJpeg(blob: Blob, quality = 0.9): Promise<Blob> {
  await acquire();
  try {
    const { heicTo } = await import("heic-to/csp");
    return await heicTo({ blob, type: "image/jpeg", quality });
  } finally {
    release();
  }
}

// --- Decode + LRU -----------------------------------------------------------

const MAX_CACHED = 24;
// Insertion order = recency (re-inserted on hit).
const cache = new Map<string, Promise<string>>();

function touch(key: string, p: Promise<string>): void {
  cache.delete(key);
  cache.set(key, p);
  while (cache.size > MAX_CACHED) {
    const [oldKey, oldP] = cache.entries().next().value as [string, Promise<string>];
    cache.delete(oldKey);
    void oldP.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  }
}

async function decode(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const jpeg = await heicToJpeg(await resp.blob());
  return URL.createObjectURL(jpeg);
}

/**
 * Decode the HEIC at `url` into a displayable JPEG blob URL. Deduped and
 * cached by `url` (it names the media by id, so it is a stable key).
 */
export function decodeHeicToUrl(url: string): Promise<string> {
  const existing = cache.get(url);
  if (existing) {
    touch(url, existing);
    return existing;
  }
  const p = decode(url).catch((err) => {
    // Drop failed attempts so a later retry can re-decode.
    cache.delete(url);
    throw err;
  });
  touch(url, p);
  return p;
}
