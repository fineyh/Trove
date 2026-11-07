// Thumbnail worker, WebView side (ADR-037).
//
// Rust owns the queue (`media.thumb_scanned = 0`); this pulls jobs, decodes
// the original through `trove://` (the WebView already handles every format
// we show — HEIC via heic-to, video first frames via <video>), shrinks it to a
// 320px WebP and hands the bytes back to be stored in the library. Nothing
// touches the disk on the way, and nothing here sees a path.
//
// One loop per open library, one job at a time: a full-size decode of a
// 12MP photo is ~48MB of bitmap, and this runs while the user is browsing.

import * as ipc from "../ipc/client";
import { heicToJpeg, isHeicExt } from "./heic";
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

async function encode(
  source: CanvasImageSource,
  w: number,
  h: number,
): Promise<{ bytes: Uint8Array; mime: string; width: number; height: number }> {
  const [tw, th] = fit(w, h);
  const canvas = new OffscreenCanvas(tw, th);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, tw, th);
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: QUALITY });
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mime: blob.type || "image/webp",
    width: tw,
    height: th,
  };
}

async function makeImage(lib: string, job: ipc.ThumbJob): Promise<Made> {
  const resp = await fetch(ipc.mediaSrc(lib, job.mediaId));
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  let blob = await resp.blob();
  if (isHeicExt(job.ext)) blob = await heicToJpeg(blob, 0.85);
  // Applies EXIF orientation by default, so width/height are as displayed.
  const bmp = await createImageBitmap(blob);
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

async function makeVideo(lib: string, job: ipc.ThumbJob): Promise<Made> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "metadata";
  video.playsInline = true;
  try {
    const meta = once(video, "loadedmetadata");
    video.src = ipc.mediaSrc(lib, job.mediaId);
    await withTimeout(meta, VIDEO_TIMEOUT_MS);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    // Skip the black first frame most cameras write, but stay early.
    const seeked = once(video, "seeked");
    video.currentTime = Math.min(1, duration * 0.1);
    await withTimeout(seeked, VIDEO_TIMEOUT_MS);
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error("no video frame");
    const out = await encode(video, w, h);
    return {
      ...out,
      origWidth: w,
      origHeight: h,
      durationMs: duration > 0 ? duration * 1000 : undefined,
    };
  } finally {
    video.removeAttribute("src");
    video.load();
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
