// Temporary, view-only transform for the viewers (Lightbox / ItemsViewer /
// the player window): rotation + zoom + pan, for images AND videos. The
// original file is never touched — we only transform the element with CSS.
//
// Interaction model (ADR-059) — no modes, every gesture works from the start:
//   - Wheel / touchpad pinch: zoom about the pointer, eased over a few frames.
//   - Drag: pans, but only while there is overflow to pan to.
//   - Double-click (images): fit ↔ 1:1 at the pointer.
//   - + / - / 0: zoom about the stage centre / back to fit.
//   - The range is fit (floor) … whichever is larger of 8× fit and 4× 1:1.
//
// Rotation and zoom/pan live in ONE hook: panning has to follow the hand at
// any angle and the pannable extents swap at a quarter turn.
//
// Composition: `translate(tx,ty) scale(s) rotate(deg)`, translate outermost so
// it is in screen pixels (a drag tracks the pointer 1:1 at any angle).
//
// Rendering is imperative: a requestAnimationFrame loop eases the *rendered*
// state toward the goal and writes `style.transform` directly. React only owns
// the fit size, cursor and the badge value, so a zoom never re-renders per
// frame, and the transform is never in React's `style` (React would overwrite
// it on the next render).
//
// Cursor-anchored zoom. With `transform-origin: 50% 50%`, the element's layout
// centre `c` is drawn at `c + t`, which is also the transformed bounding box's
// centre, so `c = rectCentre - t` for the state we last wrote. Each frame
// zooms s → s' about the anchor `q`:
//
//     t' = t + (q - c - t) * (1 - s'/s)
//
// which keeps the content under `q` fixed for the whole animation, not just at
// its end. The offset is clamped every frame, so zooming out near an edge
// slides the picture back in smoothly.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

type MediaEl = HTMLImageElement | HTMLVideoElement;

/** Fit-to-viewport is the floor: zooming out past it just adds letterboxing. */
const MIN_SCALE = 1;
/** Ceiling relative to fit, for pictures whose 1:1 is close to fit. */
const MAX_FIT_SCALE = 8;
/** Ceiling relative to 1:1, for big pictures (1:1 may already be 10× fit). */
const MAX_PIXEL_SCALE = 4;
/** Mouse wheel: one Chromium notch (deltaY ≈ 100) ≈ 22% per step. */
const WHEEL_FACTOR = 0.002;
/** Touchpad pinch arrives as ctrl+wheel with small deltas. */
const PINCH_FACTOR = 0.01;
/** Buttons / keyboard. */
const STEP = 1.25;
/** Double-click target when 1:1 is (nearly) fit already. */
const FALLBACK_DOUBLE_CLICK_SCALE = 2.5;
/** Easing time constant: ~95% of the way in 3τ. */
const TAU_MS = 55;
/** A press that moves less than this is still a click (play / pause). */
const DRAG_SLOP_PX = 4;

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n));

export interface ViewerTransform {
  /** Unbounded signed multiple of 90, so repeated clicks keep spinning the
   *  short way round instead of snapping back through 0. */
  rotation: number;
  rotateLeft: () => void;
  rotateRight: () => void;
  /** Zoom as a percentage of the media's own pixels (100 = 1:1). */
  percent: number;
  zoomed: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Back to fit, centred. */
  resetView: () => void;
  /** Callback ref for the stage (the area the media sits in). The wheel
   *  listener is attached whenever the element appears, so a viewer that
   *  first renders a spinner still gets zoom once the media shows up. */
  stageRef: (el: HTMLElement | null) => void;
  /** Callback ref for the `<img>` / `<video>`. */
  mediaRef: (el: MediaEl | null) => void;
  /** Fit size + cursor. Holds no transform — that is written imperatively. */
  mediaStyle: CSSProperties;
  mediaHandlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onDoubleClick: (e: ReactMouseEvent<HTMLElement>) => void;
  };
}

export interface ViewerTransformOptions {
  /** Size the media box to exactly this (CSS lengths), swapped at a quarter
   *  turn, and let `object-fit: contain` scale the picture up or down inside
   *  it. Used by the player window, whose picture follows the window size.
   *  Omitted: the overlay viewers' 90vw × 85vh caps, which only shrink. */
  fill?: { width: string; height: string };
  /** Pixels taken from the right of the window by a side panel (the info
   *  panel, ADR-062): the caps measure the width that's left. */
  inset?: number;
}

interface Rendered {
  s: number;
  x: number;
  y: number;
  r: number;
}

/**
 * @param resetKey whatever identifies the media on screen (message id, index,
 *   …). Rotation, zoom and pan all snap back whenever it changes.
 */
export function useViewerTransform(
  resetKey: unknown,
  options?: ViewerTransformOptions,
): ViewerTransform {
  const [rotation, setRotation] = useState(0);
  const [goalScale, setGoalScale] = useState(MIN_SCALE);
  const [percent, setPercent] = useState(100);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<HTMLElement | null>(null);

  const mediaEl = useRef<MediaEl | null>(null);
  const stageEl = useRef<HTMLElement | null>(null);
  stageEl.current = stage;
  /** What is on screen right now. */
  const cur = useRef<Rendered>({ s: 1, x: 0, y: 0, r: 0 });
  /** Where the animation is heading. */
  const goal = useRef({ s: 1, r: 0 });
  /** Screen point held still while the scale eases; null = keep the offset. */
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<number | undefined>(undefined);
  const lastTime = useRef(0);

  const write = useCallback(() => {
    const el = mediaEl.current;
    if (!el) return;
    const { s, x, y, r } = cur.current;
    el.style.transform = `translate(${x}px, ${y}px) scale(${s}) rotate(${r}deg)`;
  }, []);

  /** Pannable range: only the overflow beyond the stage, so at fit size the
   *  picture cannot move. Uses the layout size, which transforms never touch. */
  const clampOffset = useCallback((x: number, y: number, s: number) => {
    const el = mediaEl.current;
    if (!el) return { x: 0, y: 0 };
    const box = pictureBox(el);
    const quarter = isQuarterTurn(goal.current.r);
    const shownW = (quarter ? box.h : box.w) * s;
    const shownH = (quarter ? box.w : box.h) * s;
    const view = viewSize(stageEl.current);
    const maxX = Math.max(0, (shownW - view.w) / 2);
    const maxY = Math.max(0, (shownH - view.h) / 2);
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  }, []);

  /** Scale at which one media pixel covers one CSS pixel. */
  const oneToOne = useCallback((): number | null => {
    const el = mediaEl.current;
    if (!el) return null;
    const [nw] = naturalSize(el);
    const shownW = pictureBox(el).w;
    return nw && shownW ? nw / shownW : null;
  }, []);

  const maxScale = useCallback((): number => {
    const px = oneToOne();
    return Math.max(MAX_FIT_SCALE, px ? px * MAX_PIXEL_SCALE : 0);
  }, [oneToOne]);

  const publish = useCallback(() => {
    const s = goal.current.s;
    setGoalScale(s);
    const px = oneToOne();
    setPercent(Math.round(px ? (s / px) * 100 : s * 100));
  }, [oneToOne]);

  const tick = useCallback(
    (now: number) => {
      frame.current = undefined;
      const dt = Math.min(64, now - (lastTime.current || now - 16));
      lastTime.current = now;
      const k = 1 - Math.exp(-dt / TAU_MS);
      const c = cur.current;
      const g = goal.current;
      const el = mediaEl.current;

      let { s, x, y, r } = c;
      if (s !== g.s) {
        // Ease in log space so zooming in and out feel equally fast.
        const s2 =
          Math.abs(Math.log(g.s / s)) < 0.002 ? g.s : s * Math.pow(g.s / s, k);
        const q = anchor.current;
        if (q && el) {
          const rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2 - x;
          const cy = rect.top + rect.height / 2 - y;
          const f = 1 - s2 / s;
          x += (q.x - cx - x) * f;
          y += (q.y - cy - y) * f;
        }
        s = s2;
      }
      if (r !== g.r) {
        r = Math.abs(g.r - r) < 0.2 ? g.r : r + (g.r - r) * k;
      }
      const clamped = clampOffset(x, y, s);
      cur.current = { s, x: clamped.x, y: clamped.y, r };
      write();

      if (s !== g.s || r !== g.r) {
        frame.current = requestAnimationFrame(tick);
      } else {
        anchor.current = null;
        lastTime.current = 0;
      }
    },
    [clampOffset, write],
  );

  const animate = useCallback(() => {
    if (frame.current === undefined) {
      lastTime.current = 0;
      frame.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );

  /** Head for scale `next`, holding `at` (screen point) still. */
  const zoomTo = useCallback(
    (next: number, at: { x: number; y: number } | null) => {
      const s = clamp(next, MIN_SCALE, maxScale());
      if (s === goal.current.s) return;
      goal.current.s = s;
      anchor.current = at;
      publish();
      animate();
    },
    [animate, maxScale, publish],
  );

  const stageCentre = useCallback(() => {
    const st = stageEl.current;
    if (!st) return null;
    const rect = st.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, []);

  // New media: snap everything back without animating.
  useLayoutEffect(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    cur.current = { s: 1, x: 0, y: 0, r: 0 };
    goal.current = { s: 1, r: 0 };
    anchor.current = null;
    setRotation(0);
    setGoalScale(MIN_SCALE);
    setPercent(100);
    write();
  }, [resetKey, write]);

  // Rotation buttons change the React state; the loop eases toward it.
  useLayoutEffect(() => {
    if (goal.current.r === rotation) return;
    goal.current.r = rotation;
    animate();
  }, [rotation, animate]);

  // Window / fullscreen size changes move the pan limits, and so does the
  // stage alone narrowing (a side panel opening).
  useEffect(() => {
    const onResize = () => {
      const c = cur.current;
      const t = clampOffset(c.x, c.y, c.s);
      cur.current = { ...c, ...t };
      write();
      publish();
    };
    window.addEventListener("resize", onResize);
    const ro = stage ? new ResizeObserver(onResize) : null;
    if (stage) ro?.observe(stage);
    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, [stage, clampOffset, write, publish]);

  // Wheel: non-passive (React's `onWheel` is passive) so the WebView doesn't
  // also scroll. Re-attached whenever the stage element changes.
  useEffect(() => {
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const target = e.target as Element | null;
      // The video's control bar keeps its own wheel (volume popover etc.).
      if (target?.closest?.("[data-viewer-chrome]")) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? window.innerHeight : 1;
      const factor = e.ctrlKey ? PINCH_FACTOR : WHEEL_FACTOR;
      zoomTo(goal.current.s * Math.exp(-e.deltaY * unit * factor), {
        x: e.clientX,
        y: e.clientY,
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [stage, zoomTo]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || goal.current.s <= MIN_SCALE) return;
      const el = e.currentTarget;
      let lastX = e.clientX;
      let lastY = e.clientY;
      const originX = e.clientX;
      const originY = e.clientY;
      let moved = false;
      // A drag takes over from any zoom still easing in.
      goal.current.s = cur.current.s;
      anchor.current = null;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Capture only keeps the drag alive outside the element.
      }

      const onMove = (ev: globalThis.PointerEvent) => {
        if (!moved) {
          if (Math.hypot(ev.clientX - originX, ev.clientY - originY) < DRAG_SLOP_PX) return;
          moved = true;
          setDragging(true);
        }
        const c = cur.current;
        const t = clampOffset(c.x + ev.clientX - lastX, c.y + ev.clientY - lastY, c.s);
        lastX = ev.clientX;
        lastY = ev.clientY;
        cur.current = { ...c, ...t };
        write();
      };
      const onUp = (ev: globalThis.PointerEvent) => {
        el.releasePointerCapture?.(ev.pointerId);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        setDragging(false);
        if (moved) swallowNextClick();
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    },
    [clampOffset, write],
  );

  const onDoubleClick = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      const at = { x: e.clientX, y: e.clientY };
      if (goal.current.s > MIN_SCALE) {
        zoomTo(MIN_SCALE, at);
        return;
      }
      const px = oneToOne();
      zoomTo(px && px > 1.2 ? px : FALLBACK_DOUBLE_CLICK_SCALE, at);
    },
    [oneToOne, zoomTo],
  );

  const mediaRef = useCallback(
    (el: MediaEl | null) => {
      mediaEl.current = el;
      if (el) write();
    },
    [write],
  );

  const rotateLeft = useCallback(() => setRotation((r) => r - 90), []);
  const rotateRight = useCallback(() => setRotation((r) => r + 90), []);
  const zoomIn = useCallback(
    () => zoomTo(goal.current.s * STEP, stageCentre()),
    [zoomTo, stageCentre],
  );
  const zoomOut = useCallback(
    () => zoomTo(goal.current.s / STEP, stageCentre()),
    [zoomTo, stageCentre],
  );
  const resetView = useCallback(() => zoomTo(MIN_SCALE, null), [zoomTo]);

  // At a quarter turn the element's visual width/height swap, so swap the
  // size constraints too — the rotated media stays inside the viewport.
  const quarterTurned = isQuarterTurn(rotation);
  const fill = options?.fill;
  const inset = options?.inset ?? 0;
  const across = inset > 0 ? `calc((100vw - ${inset}px) * 0.9)` : "90vw";
  const fit: CSSProperties = fill
    ? {
        width: quarterTurned ? fill.height : fill.width,
        height: quarterTurned ? fill.width : fill.height,
        maxWidth: "none",
        maxHeight: "none",
      }
    : {
        maxWidth: quarterTurned ? "85vh" : across,
        maxHeight: quarterTurned ? across : "85vh",
      };
  const zoomed = goalScale > MIN_SCALE;

  return {
    rotation,
    rotateLeft,
    rotateRight,
    percent,
    zoomed,
    zoomIn,
    zoomOut,
    resetView,
    stageRef: setStage,
    mediaRef,
    mediaStyle: {
      ...fit,
      cursor: dragging ? "grabbing" : zoomed ? "grab" : undefined,
      // The pointer handlers own the gesture, not the WebView's native
      // image drag / touch pan.
      touchAction: "none",
    },
    mediaHandlers: { onPointerDown, onDoubleClick },
  };
}

/** After a drag, the release still fires a `click` (on a video that would
 *  toggle playback). Swallow it before React sees it. */
function swallowNextClick(): void {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    cleanup();
  };
  const cleanup = () => window.removeEventListener("click", stop, true);
  window.addEventListener("click", stop, true);
  // No click follows when the release lands outside the window.
  window.setTimeout(cleanup, 0);
}

function naturalSize(el: MediaEl): [number, number] {
  return el instanceof HTMLVideoElement
    ? [el.videoWidth, el.videoHeight]
    : [el.naturalWidth, el.naturalHeight];
}

/** Size of the picture itself inside an `object-fit: contain` box. With the
 *  overlay viewers' caps the box hugs the picture; in `fill` mode (and for
 *  video) the box can be bigger and the picture is letterboxed. */
function pictureBox(el: MediaEl): { w: number; h: number } {
  const w = el.clientWidth;
  const h = el.clientHeight;
  const [nw, nh] = naturalSize(el);
  if (!nw || !nh || !w || !h) return { w, h };
  const ratio = nw / nh;
  const shownW = Math.min(w, h * ratio);
  return { w: shownW, h: shownW / ratio };
}

/** The area the picture may fill: the screen while fullscreen (the stage is
 *  then whatever got fullscreened), else the stage. */
function viewSize(stage: HTMLElement | null): { w: number; h: number } {
  if (document.fullscreenElement || !stage) {
    return { w: window.innerWidth, h: window.innerHeight };
  }
  return { w: stage.clientWidth, h: stage.clientHeight };
}

function isQuarterTurn(rotation: number): boolean {
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized === 90 || normalized === 270;
}
