// Viewing history (ADR-054): what the viewers and the main window report.
//
// A view is one item open in a viewer; its spans are the stretches actually
// watched. Checked once a second (and at once on play / pause / seek /
// visibility changes), written every 15 seconds and when a span ends. No row
// is created until a second has been watched, so flicking past an item leaves
// nothing behind.

import { useEffect } from "react";
import * as ipc from "../ipc/client";
import type { ViewSurface } from "../ipc/client";

const POLL_MS = 1_000;
const FLUSH_MS = 15_000;
/** Photos and the main window stop counting after this long without input. */
const IDLE_MS = 120_000;
/** Watched less than this: not worth a record. */
const MIN_MS = 1_000;

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
const VIDEO_EVENTS = ["play", "playing", "pause", "ended", "waiting", "seeking", "seeked"] as const;

/** The local UTC offset now, in minutes (UTC+8 → 480). */
export function tzOffsetNow(): number {
  return -new Date().getTimezoneOffset();
}

let lastInput = Date.now();
let inputHooked = false;

/** One listener set per window, shared by every tracker in it. */
function hookInput(): void {
  if (inputHooked) return;
  inputHooked = true;
  const bump = () => {
    lastInput = Date.now();
  };
  for (const ev of INPUT_EVENTS) window.addEventListener(ev, bump, { passive: true, capture: true });
}

function inUse(now: number): boolean {
  return document.visibilityState === "visible" && document.hasFocus() && now - lastInput < IDLE_MS;
}

interface Span {
  start: number;
  end: number;
  /** The end last written; differs from `end` while there is news. */
  sent: number;
}

function videoFacts(v: HTMLVideoElement | null) {
  if (!v) return { coveredMs: null, lastPosMs: null, durationMs: null };
  let covered = 0;
  for (let i = 0; i < v.played.length; i++) covered += v.played.end(i) - v.played.start(i);
  return {
    coveredMs: Math.round(covered * 1000),
    lastPosMs: Math.round(v.currentTime * 1000),
    durationMs: Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : null,
  };
}

/**
 * Record watching `messageId` while it is open. For a video pass its element
 * (nothing is tracked until it exists); a photo counts while the window is in
 * front and in use. `messageId === null` tracks nothing.
 */
export function useViewTracker(
  lib: string,
  messageId: number | null,
  kind: "video" | "image",
  surface: ViewSurface,
  videoEl: HTMLVideoElement | null,
): void {
  // A photo ignores whatever element a video before it left behind.
  const video = kind === "video" ? videoEl : null;
  useEffect(() => {
    if (!lib || messageId === null) return;
    if (kind === "video" && !video) return;
    hookInput();

    const spans: Span[] = [];
    let current: Span | null = null;
    let viewId: number | null = null;
    let begun = false;
    let lastFlush = Date.now();
    let sentPos: number | null = null;

    const watching = (now: number) => {
      if (document.visibilityState !== "visible") return false;
      if (kind === "image") return inUse(now);
      const v = video!;
      return !v.paused && !v.ended && !v.seeking && v.readyState >= 3;
    };

    const watched = () => spans.reduce((sum, s) => sum + s.end - s.start, 0);

    const flush = () => {
      if (viewId === null) return;
      lastFlush = Date.now();
      const facts = videoFacts(kind === "video" ? video : null);
      const dirty = spans.filter((s) => s.end !== s.sent);
      // Nothing new watched: still pass on a moved position (seeking while paused).
      if (dirty.length === 0 && facts.lastPosMs === sentPos) return;
      sentPos = facts.lastPosMs;
      const send = dirty.length > 0 ? dirty : [null];
      for (const s of send) {
        if (s) s.sent = s.end;
        void ipc
          .statsViewTick(lib, viewId, {
            spanStart: s?.start ?? null,
            spanEnd: s?.end ?? null,
            ...facts,
          })
          .catch(() => {});
      }
    };

    const maybeBegin = () => {
      if (begun || spans.length === 0) return;
      const total = watched();
      const endedShort = kind === "video" && video!.ended && total > 0;
      if (total < MIN_MS && !endedShort) return;
      begun = true;
      void ipc
        .statsViewBegin(lib, messageId, surface, spans[0].start, tzOffsetNow())
        .then((id) => {
          viewId = id;
          flush();
        })
        .catch(() => {});
    };

    const poll = () => {
      const now = Date.now();
      if (watching(now)) {
        if (current) current.end = now;
        else {
          current = { start: now, end: now, sent: -1 };
          spans.push(current);
        }
      } else if (current) {
        current.end = now;
        current = null;
        flush();
      }
      if (!begun) maybeBegin();
      else if (now - lastFlush >= FLUSH_MS) flush();
    };

    const finish = () => {
      if (current) {
        current.end = Date.now();
        current = null;
      }
      if (begun) flush();
      else maybeBegin();
    };

    const timer = window.setInterval(poll, POLL_MS);
    for (const ev of VIDEO_EVENTS) video?.addEventListener(ev, poll);
    document.addEventListener("visibilitychange", poll);
    // A popup window closing doesn't unmount React; this is the last chance.
    window.addEventListener("pagehide", finish);
    poll();

    return () => {
      window.clearInterval(timer);
      for (const ev of VIDEO_EVENTS) video?.removeEventListener(ev, poll);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("pagehide", finish);
      finish();
    };
  }, [lib, messageId, kind, surface, video]);
}

/**
 * The main window's time in front and in use, recorded against the library
 * on screen. Spans are cut when the library changes.
 */
export function usePresenceTracker(getLib: () => string | null): void {
  useEffect(() => {
    hookInput();
    let span: { lib: string; start: number; end: number; offset: number } | null = null;
    let lastFlush = Date.now();

    const send = () => {
      if (!span || span.end <= span.start) return;
      lastFlush = Date.now();
      void ipc.statsPresenceTick(span.lib, span.start, span.end, span.offset).catch(() => {});
    };

    const poll = () => {
      const now = Date.now();
      const lib = getLib();
      if (span && (!inUse(now) || span.lib !== lib)) {
        // Idle: it ended when the idle time ran out, not at this poll.
        span.end = Math.max(span.end, Math.min(now, lastInput + IDLE_MS));
        send();
        span = null;
      }
      if (!span && lib && inUse(now)) {
        span = { lib, start: now, end: now, offset: tzOffsetNow() };
      } else if (span) {
        span.end = now;
        if (now - lastFlush >= FLUSH_MS) send();
      }
    };

    const timer = window.setInterval(poll, 5 * POLL_MS);
    window.addEventListener("blur", poll);
    window.addEventListener("pagehide", send);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("blur", poll);
      window.removeEventListener("pagehide", send);
      if (span) {
        span.end = Date.now();
        send();
      }
    };
  }, [getLib]);
}
