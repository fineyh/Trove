// Thumbnail worker, WebView side (ADR-037).
//
// Rust owns the queue (`media.thumb_scanned = 0`); this pulls jobs, decodes
// the original through `trove://` (the WebView already handles every format
// we show — HEIC via the system decoder or heic-to, video first frames via
// <video>), shrinks it to a
// 320px WebP and hands the bytes back to be stored in the library. Nothing
// touches the disk on the way, and nothing here sees a path.
//
// One loop per open library, one job at a time: a full-size decode of a
// 12MP photo is ~48MB of bitmap, and this runs while the user is browsing.

import * as ipc from "../ipc/client";
import { decodeHeicBitmap, isHeicExt } from "./heic";
import { useThumbsStore } from "../stores/thumbs";

const MAX_EDGE = 320;
const QUALITY = 0.75;
const BATCH = 8;
const VIDEO_TIMEOUT_MS = 20_000;

interface Made {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  origWidth: number;
  origHeight: number;
  durationMs?: number;
}

function fit(w: number, h: number): [number, number] {
  const s = Math.min(1, MAX_EDGE / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

function draw(source: CanvasImageSource, w: number, h: number): OffscreenCanvas {
  const [tw, th] = fit(w, h);
  const canvas = new OffscreenCanvas(tw, th);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, tw, th);
  return canvas;
}

async function toWebp(
  canvas: OffscreenCanvas,
): Promise<{ bytes: Uint8Array; mime: string; width: number; height: number }> {
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: QUALITY });
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mime: blob.type || "image/webp",
    width: canvas.width,
    height: canvas.height,
  };
}

function encode(source: CanvasImageSource, w: number, h: number) {
  return toWebp(draw(source, w, h));
}

async function makeImage(lib: string, job: ipc.ThumbJob): Promise<Made> {
  const src = ipc.mediaSrc(lib, job.mediaId);
  if (isHeicExt(job.ext)) {
    // Comes back upright and, from the system decoder, already shrunk.
    const { bitmap, width, height } = await decodeHeicBitmap(src, MAX_EDGE);
    try {
      const out = await encode(bitmap, bitmap.width, bitmap.height);
      return { ...out, origWidth: width, origHeight: height };
    } finally {
      bitmap.close();
    }
  }
  const resp = await fetch(src);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  // Applies EXIF orientation by default, so width/height are as displayed.
  const bmp = await createImageBitmap(await resp.blob());
  try {
    const out = await encode(bmp, bmp.width, bmp.height);
    return { ...out, origWidth: bmp.width, origHeight: bmp.height };
  } finally {
    bmp.close();
  }
}

function once(el: HTMLMediaElement, ev: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error(`video ${ev} failed`));
    };
    const cleanup = () => {
      el.removeEventListener(ev, ok);
      el.removeEventListener("error", bad);
    };
    el.addEventListener(ev, ok);
    el.addEventListener("error", bad);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

// Where to look for a video cover, in seconds. People tell videos apart by
// how they open, so stay in the first few seconds and only move on while the
// frame is blank (black, white, one flat colour, or not painted at all).
const COVER_TIMES = [1, 2, 3, 5];

interface Look {
  /** The frame came back transparent: the decoder hadn't painted it yet. */
  unpainted: boolean;
  blank: boolean;
  /** Luma spread; more detail = a better cover when every frame is blank. */
  detail: number;
}

function look(canvas: OffscreenCanvas): Look {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let n = 0;
  let alpha = 0;
  let sum = 0;
  let sq = 0;
  // Every 4th pixel is plenty for a 320px frame.
  for (let i = 0; i < data.length; i += 16) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    alpha += data[i + 3];
    sum += y;
    sq += y * y;
    n++;
  }
  const mean = sum / n;
  const detail = Math.sqrt(Math.max(0, sq / n - mean * mean));
  const unpainted = alpha / n < 250;
  return { unpainted, blank: unpainted || mean < 24 || mean > 235 || detail < 10, detail };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Resolve once the seeked frame has reached the compositor (or soon after). */
function presented(video: HTMLVideoElement): Promise<void> {
  const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
  if (!v.requestVideoFrameCallback) return sleep(50);
  return Promise.race([new Promise<void>((r) => v.requestVideoFrameCallback!(() => r())), sleep(300)]);
}

async function frameAt(video: HTMLVideoElement, t: number): Promise<{ canvas: OffscreenCanvas; look: Look }> {
  const seeked = once(video, "seeked");
  video.currentTime = t;
  await withTimeout(seeked, VIDEO_TIMEOUT_MS);
  await presented(video);
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error("no video frame");
  let canvas = draw(video, w, h);
  let l = look(canvas);
  // A transparent frame means "not decoded yet", not a dark scene: give the
  // decoder a moment before calling it blank.
  for (let i = 0; l.unpainted && i < 3; i++) {
    await sleep(150);
    canvas = draw(video, w, h);
    l = look(canvas);
  }
  return { canvas, look: l };
}

async function makeVideo(lib: string, job: ipc.ThumbJob): Promise<Made> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "metadata";
  video.playsInline = true;
  // In the document (invisible) so the decoder paints frames for it.
  video.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;";
  document.body.appendChild(video);
  try {
    const meta = once(video, "loadedmetadata");
    video.src = ipc.mediaSrc(lib, job.mediaId);
    await withTimeout(meta, VIDEO_TIMEOUT_MS);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    // The very first frame is often black; short clips start at 10% instead.
    const first = Math.min(COVER_TIMES[0], duration * 0.1);
    const times = [first, ...COVER_TIMES.slice(1).filter((t) => t < duration * 0.9)];
    let best: { canvas: OffscreenCanvas; look: Look } | null = null;
    for (const t of times) {
      const f = await frameAt(video, t);
      if (!f.look.blank) {
        best = f;
        break;
      }
      // All blank so far: keep the earliest painted one with clearly more detail.
      if (
        !best ||
        (best.look.unpainted && !f.look.unpainted) ||
        (f.look.unpainted === best.look.unpainted && f.look.detail > best.look.detail + 4)
      ) {
        best = f;
      }
    }
    if (!best || best.look.unpainted) throw new Error("no painted video frame");
    const out = await toWebp(best.canvas);
    return {
      ...out,
      origWidth: video.videoWidth,
      origHeight: video.videoHeight,
      durationMs: duration > 0 ? duration * 1000 : undefined,
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    video.remove();
  }
}

async function runOne(lib: string, job: ipc.ThumbJob): Promise<void> {
  try {
    const made = job.kind === "video" ? await makeVideo(lib, job) : await makeImage(lib, job);
    await ipc.thumbsPut(
      lib,
      {
        mediaId: job.mediaId,
        mime: made.mime,
        width: made.width,
        height: made.height,
        origWidth: made.origWidth,
        origHeight: made.origHeight,
        durationMs: made.durationMs,
      },
      made.bytes,
    );
    useThumbsStore.getState().markDone(lib, job.mediaId);
  } catch {
    // Undecodable here (unsupported codec, truncated file…): mark it so the
    // queue moves on. The UI falls back to an icon for it.
    await ipc.thumbsFail(lib, job.mediaId).catch(() => {});
    useThumbsStore.getState().markFailed(lib, job.mediaId);
  }
}

// --- Loop control -------------------------------------------------------------

const running = new Set<string>();
const again = new Set<string>();
let stopped = true;

/** Yield to the browser between jobs so scrolling stays smooth. */
function idle(): Promise<void> {
  return new Promise((resolve) => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 500 });
    } else {
      setTimeout(resolve, 16);
    }
  });
}

async function loop(lib: string): Promise<void> {
  const store = useThumbsStore.getState();
  try {
    for (;;) {
      if (stopped) return;
      const jobs = await ipc.thumbsNext(lib, BATCH);
      if (jobs.length === 0) break;
      for (const job of jobs) {
        if (stopped) return;
        await runOne(lib, job);
        await idle();
      }
      store.setRemaining(lib, await ipc.thumbsRemaining(lib));
    }
    store.setRemaining(lib, 0);
  } catch {
    // The library was locked or closed under us; a later wake restarts.
  }
}

/** Start (or nudge) the worker for one library. */
export function kickThumbs(lib: string): void {
  if (stopped) return;
  if (running.has(lib)) {
    again.add(lib);
    return;
  }
  running.add(lib);
  void (async () => {
    do {
      again.delete(lib);
      await loop(lib);
    } while (again.has(lib) && !stopped);
    running.delete(lib);
  })();
}

/** Begin working on `libs` and listen for new work. Returns a stop function. */
export function startThumbWorker(libs: string[]): () => void {
  stopped = false;
  for (const l of libs) kickThumbs(l);
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  void ipc.onThumbsWake((lib) => kickThumbs(lib)).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    stopped = true;
    unlisten?.();
  };
}
