// HEIC/HEIF display support (ADR-022, ADR-060).
//
// WebView2 (Chromium) can't decode HEIC. Two ways in, cheapest first:
//   1. The system decoder: `trove://…/heic/<id>` asks Windows (WIC, with the
//      HEIF + HEVC extensions — what the Photos app uses, GPU-decoded) and
//      gets back an uncompressed BMP. ~0.25s for 12MP.
//   2. `heic-to` (libheif in WASM, in a worker) when this machine has no
//      system decoder. Its pixels go straight into a BMP too — no JPEG
//      encode on the way.
// Once (1) has failed where (2) worked, (1) is skipped for the session.
//
// Decoded images are held as blob URLs in a tiny LRU (a 12MP BMP is ~36MB);
// nothing is decoded ahead of time.
//
// This module stays React-free so the lean `player.html` bundle can import the
// decode primitives without pulling in React. The React hook lives in
// `useDisplayableImageUrl.ts`.

/** True for HEIC/HEIF by (lower-case, dot-less) extension. */
export function isHeicExt(ext: string | null | undefined): boolean {
  return ext === "heic" || ext === "heif";
}

/** The original's `…/media/<id>` URL → the same file through the system decoder. */
export function systemHeicSrc(mediaUrl: string, maxEdge?: number): string {
  const u = mediaUrl.replace(/\/media\/(\d+)$/, "/heic/$1");
  return maxEdge ? `${u}?max=${maxEdge}` : u;
}

let systemOff = false;

// --- WASM fallback ------------------------------------------------------------

// libheif is single-threaded in its worker; two at once only fight for it.
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

async function wasmBitmap(mediaUrl: string): Promise<ImageBitmap> {
  const resp = await fetch(mediaUrl);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  await acquire();
  try {
    const { heicTo } = await import("heic-to/csp");
    return await heicTo({ blob, type: "bitmap" });
  } finally {
    release();
  }
}

/** Pixels → top-down 24-bit BMP. Copying bytes, no compression. */
function bitmapToBmp(bmp: ImageBitmap): Blob {
  const w = bmp.width;
  const h = bmp.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bmp, 0, 0);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const stride = (w * 3 + 3) & ~3;
  const out = new Uint8Array(54 + stride * h);
  const dv = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  dv.setUint32(2, out.length, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, -h, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(34, stride * h, true);
  for (let y = 0; y < h; y++) {
    let s = y * w * 4;
    let d = 54 + y * stride;
    for (let x = 0; x < w; x++) {
      out[d] = rgba[s + 2];
      out[d + 1] = rgba[s + 1];
      out[d + 2] = rgba[s];
      s += 4;
      d += 3;
    }
  }
  return new Blob([out], { type: "image/bmp" });
}

// --- Either way ---------------------------------------------------------------

/** Run the system decoder; null when it can't (no extensions, not Windows). */
async function systemFetch(mediaUrl: string, maxEdge?: number): Promise<Response | null> {
  if (systemOff) return null;
  try {
    const resp = await fetch(systemHeicSrc(mediaUrl, maxEdge));
    return resp.ok ? resp : null;
  } catch {
    return null;
  }
}

async function wasmAfterSystemMiss<T>(tried: boolean, work: () => Promise<T>): Promise<T> {
  const out = await work();
  // Our decoder read the file fine, so the system one is what's missing.
  if (tried) systemOff = true;
  return out;
}

/**
 * Decoded pixels for the thumbnail worker, at most `maxEdge` on the long
 * edge when the system decoder does the shrinking, plus the original size.
 */
export async function decodeHeicBitmap(
  mediaUrl: string,
  maxEdge: number,
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  const tried = !systemOff;
  const resp = await systemFetch(mediaUrl, maxEdge);
  if (resp) {
    const bitmap = await createImageBitmap(await resp.blob());
    const [w, h] = (resp.headers.get("X-Image-Size") ?? "").split("x").map(Number);
    return { bitmap, width: w || bitmap.width, height: h || bitmap.height };
  }
  return wasmAfterSystemMiss(tried, async () => {
    const bitmap = await wasmBitmap(mediaUrl);
    return { bitmap, width: bitmap.width, height: bitmap.height };
  });
}

async function decodeToUrl(mediaUrl: string): Promise<string> {
  const tried = !systemOff;
  const resp = await systemFetch(mediaUrl);
  if (resp) return URL.createObjectURL(await resp.blob());
  return wasmAfterSystemMiss(tried, async () => {
    const bmp = await wasmBitmap(mediaUrl);
    try {
      return URL.createObjectURL(bitmapToBmp(bmp));
    } finally {
      bmp.close();
    }
  });
}

// --- LRU ----------------------------------------------------------------------

// Enough to step back to the previous photo without decoding it again.
const MAX_CACHED = 3;
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

/**
 * Decode the HEIC at `url` (its `…/media/<id>` URL) into a displayable blob
 * URL. Deduped and cached by `url`, which names the media by id.
 */
export function decodeHeicToUrl(url: string): Promise<string> {
  const existing = cache.get(url);
  if (existing) {
    touch(url, existing);
    return existing;
  }
  const p = decodeToUrl(url).catch((err) => {
    // Drop failed attempts so a later retry can re-decode.
    cache.delete(url);
    throw err;
  });
  touch(url, p);
  return p;
}
