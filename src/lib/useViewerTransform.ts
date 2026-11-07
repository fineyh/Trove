// Temporary, view-only transform for the viewers (Lightbox / MapPhotoViewer /
// the player window): rotation + zoom + pan. The original file is never touched —
// we only transform the element with CSS.
//
// Rotation and zoom/pan live in ONE hook on purpose. They are not independent:
// panning has to move the picture the way the user's hand moves (drag right →
// picture goes right) no matter how far the picture is rotated, and the fit
// constraints swap at a quarter turn. Two hooks owning two transforms would
// each have to know the other's state to compose correctly.
//
// Composition: `translate(tx,ty) scale(s) rotate(deg)`.
//   - `rotate` is innermost, so it spins the picture in its own box.
//   - `scale` is uniform, so it commutes with the rotation.
//   - `translate` is OUTERMOST and therefore expressed in *screen* pixels,
//     which is what makes a drag track the pointer 1:1 at any angle.
//
// Cursor-anchored zoom. With `transform-origin: 50% 50%` (the default), the
// element's untransformed centre `c` maps to `c + t`, and the transformed
// bounding box's centre is exactly that point — so `getBoundingClientRect()`
// hands us `c + t` without us having to track `c` at all. Keeping the content
// point under cursor `q` fixed across a scale change s → s' then reduces to
//
//     t' = t + (q - rectCentre) * (1 - s'/s)
//
// with the rotation cancelling out of the algebra entirely.
//
// Scope: images only. Videos keep plain rotation (see `rotationStyle`) because
// scaling a `<video>` would fight both the custom control bar's anchoring and
// the fullscreen fill logic in `RotatableVideo`.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

/** Fit-to-viewport is the floor: zooming out past it just adds letterboxing. */
const MIN_SCALE = 1;
const MAX_SCALE = 8;
/** Wheel sensitivity. One Chromium notch (deltaY ≈ 100) ≈ 16% per step. */
const WHEEL_FACTOR = 0.0015;
/** Fallback zoom for a double-click when the natural size is unknown. */
const FALLBACK_DOUBLE_CLICK_SCALE = 2.5;
/** How long after the last wheel event the smoothing transition comes back. */
const INSTANT_DECAY_MS = 180;

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n));

export interface ViewerTransform {
  /** Unbounded signed multiple of 90, so repeated clicks keep spinning the
   *  short way round instead of snapping back through 0. */
  rotation: number;
  rotateLeft: () => void;
  rotateRight: () => void;
  scale: number;
  zoomed: boolean;
  /** Zoom about the viewport centre — for buttons and keyboard. */
  zoomIn: () => void;
  zoomOut: () => void;
  /** Back to fit, centred. */
  resetView: () => void;
  /** Attach to the fullscreen overlay: the wheel listener is registered here
   *  manually because React's own `onWheel` is passive and so cannot
   *  `preventDefault()` the WebView's scroll/zoom. */
  stageRef: React.RefObject<HTMLDivElement>;
  /** Attach to the `<img>`: used for the pan clamp and the 1:1 target. */
  mediaRef: React.RefObject<HTMLImageElement>;
  /** Style for the image: rotation + zoom + pan. */
  mediaStyle: CSSProperties;
  /** Style for a video: rotation only, identical to the pre-zoom behaviour. */
  rotationStyle: CSSProperties;
  /** Spread onto the image element. */
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
}

/**
 * @param resetKey whatever identifies the media on screen (message id, index,
 *   …). Rotation, zoom and pan all snap back whenever it changes, in a layout
 *   effect so the newly shown picture never paints a stale transform.
 */
export function useViewerTransform(
  resetKey: unknown,
  options?: ViewerTransformOptions,
): ViewerTransform {
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  /** True while dragging or wheeling — the smoothing transition is dropped so
   *  a pan tracks the pointer exactly instead of lagging behind it. */
  const [instant, setInstant] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLImageElement>(null);
  const instantTimer = useRef<number | undefined>(undefined);
  /** Set right after `clampOffset` is defined; the rotation effect above it
   *  needs to call it without reordering the hook's declarations. */
  const clampOffsetRef = useRef<
    (x: number, y: number, s: number, rot: number) => { x: number; y: number }
  >(() => ({ x: 0, y: 0 }));

  useLayoutEffect(() => {
    setRotation(0);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [resetKey]);

  useEffect(
    () => () => window.clearTimeout(instantTimer.current),
    [],
  );

  // The pannable range swaps at a quarter turn, so an offset that was legal
  // before a rotation can be out of bounds after it. Re-clamp instead of
  // waiting for the next drag to notice.
  useEffect(() => {
    setOffset((o) => clampOffsetRef.current(o.x, o.y, scaleRef.current, rotation));
  }, [rotation]);

  const markInstant = useCallback(() => {
    setInstant(true);
    window.clearTimeout(instantTimer.current);
    instantTimer.current = window.setTimeout(
      () => setInstant(false),
      INSTANT_DECAY_MS,
    );
  }, []);

  // Live mirrors so the imperative wheel/pointer handlers don't need to be
  // re-registered (and don't capture stale values) on every change.
  const stateRef = useRef({ scale, offset, rotation });
  stateRef.current = { scale, offset, rotation };
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  /** How far the picture may be dragged: only as far as there is overflow,
   *  so at fit size it cannot be dragged at all. Uses the picture's layout
   *  size, which the CSS transform never touches, against the stage. */
  const clampOffset = useCallback(
    (x: number, y: number, s: number, rot: number) => {
      const el = mediaRef.current;
      if (!el) return { x: 0, y: 0 };
      const box = pictureBox(el);
      const quarter = isQuarterTurn(rot);
      // On screen the extents swap at a quarter turn.
      const shownW = (quarter ? box.h : box.w) * s;
      const shownH = (quarter ? box.w : box.h) * s;
      const stage = stageRef.current;
      const maxX = Math.max(0, (shownW - (stage?.clientWidth || window.innerWidth)) / 2);
      const maxY = Math.max(0, (shownH - (stage?.clientHeight || window.innerHeight)) / 2);
      return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
    },
    [],
  );
  clampOffsetRef.current = clampOffset;

  /** Apply a new scale while keeping the content point under `anchor` fixed.
   *  `anchor` omitted = the picture's current centre (keyboard / buttons). */
  const zoomTo = useCallback(
    (next: number, anchor?: { x: number; y: number }) => {
      const { scale: s, offset: t, rotation: rot } = stateRef.current;
      const s2 = clamp(next, MIN_SCALE, MAX_SCALE);
      if (s2 === s) return;
      if (s2 === MIN_SCALE) {
        // Back at fit size there is nothing to pan to; re-centre instead of
        // leaving the picture stranded off to one side.
        setScale(MIN_SCALE);
        setOffset({ x: 0, y: 0 });
        return;
      }
      let x = t.x;
      let y = t.y;
      const el = mediaRef.current;
      if (anchor && el) {
        const rect = el.getBoundingClientRect();
        // rect centre === c + t, so `c` never has to be known.
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const k = 1 - s2 / s;
        x = t.x + (anchor.x - cx) * k;
        y = t.y + (anchor.y - cy) * k;
      }
      setScale(s2);
      setOffset(clampOffset(x, y, s2, rot));
    },
    [clampOffset],
  );

  // Wheel: non-passive so the WebView doesn't also scroll/zoom the page.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      markInstant();
      const { scale: s } = stateRef.current;
      zoomTo(s * Math.exp(-e.deltaY * WHEEL_FACTOR), {
        x: e.clientX,
        y: e.clientY,
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomTo, markInstant]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      // Only the primary button drags, and only when there's overflow to pan.
      if (e.button !== 0) return;
      const { scale: s, offset: start, rotation: rot } = stateRef.current;
      if (s <= MIN_SCALE) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget;
      const originX = e.clientX;
      const originY = e.clientY;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Capture is an optimisation (it keeps the drag alive outside the
        // element); a browser that refuses it must not break the drag.
      }
      setInstant(true);

      const onMove = (ev: globalThis.PointerEvent) => {
        setOffset(
          clampOffset(
            start.x + (ev.clientX - originX),
            start.y + (ev.clientY - originY),
            s,
            rot,
          ),
        );
      };
      const onUp = (ev: globalThis.PointerEvent) => {
        el.releasePointerCapture?.(ev.pointerId);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        setInstant(false);
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    },
    [clampOffset],
  );

  /** Scale at which one image pixel covers one CSS pixel. */
  const oneToOneScale = useCallback((): number => {
    const el = mediaRef.current;
    const shownW = el ? pictureBox(el).w : 0;
    if (!el || !el.naturalWidth || !shownW) {
      return FALLBACK_DOUBLE_CLICK_SCALE;
    }
    return clamp(el.naturalWidth / shownW, MIN_SCALE, MAX_SCALE);
  }, []);

  const onDoubleClick = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      const { scale: s } = stateRef.current;
      if (s > MIN_SCALE) {
        setScale(MIN_SCALE);
        setOffset({ x: 0, y: 0 });
        return;
      }
      const target = oneToOneScale();
      // Already 1:1 at fit size (a small picture) — a step up is still useful.
      zoomTo(
        target > MIN_SCALE ? target : FALLBACK_DOUBLE_CLICK_SCALE,
        { x: e.clientX, y: e.clientY },
      );
    },
    [oneToOneScale, zoomTo],
  );

  const rotateLeft = useCallback(() => setRotation((r) => r - 90), []);
  const rotateRight = useCallback(() => setRotation((r) => r + 90), []);
  const zoomIn = useCallback(
    () => zoomTo(stateRef.current.scale * 1.25),
    [zoomTo],
  );
  const zoomOut = useCallback(
    () => zoomTo(stateRef.current.scale / 1.25),
    [zoomTo],
  );
  const resetView = useCallback(() => {
    setScale(MIN_SCALE);
    setOffset({ x: 0, y: 0 });
  }, []);

  // At a quarter turn the element's visual width/height swap, so swap the
  // max-size constraints too — this keeps the rotated media fully inside the
  // viewport with pure CSS, no need to read the media's pixel dimensions.
  const quarterTurned = isQuarterTurn(rotation);
  const fill = options?.fill;
  const fit: CSSProperties = fill
    ? {
        width: quarterTurned ? fill.height : fill.width,
        height: quarterTurned ? fill.width : fill.height,
        maxWidth: "none",
        maxHeight: "none",
      }
    : {
        maxWidth: quarterTurned ? "85vh" : "90vw",
        maxHeight: quarterTurned ? "90vw" : "85vh",
      };
  const transition = instant ? "none" : "transform 150ms ease";
  const zoomed = scale > MIN_SCALE;

  return {
    rotation,
    rotateLeft,
    rotateRight,
    scale,
    zoomed,
    zoomIn,
    zoomOut,
    resetView,
    stageRef,
    mediaRef,
    mediaStyle: {
      ...fit,
      transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
      transition,
      cursor: zoomed ? "grab" : "zoom-in",
      // Let the pointer handlers own the gesture instead of the WebView's
      // native image drag / pan.
      touchAction: "none",
      willChange: zoomed ? "transform" : undefined,
    },
    rotationStyle: {
      ...fit,
      transform: `rotate(${rotation}deg)`,
      transition: "transform 150ms ease",
    },
    mediaHandlers: { onPointerDown, onDoubleClick },
  };
}

/** Size of the picture itself inside an `object-fit: contain` box. With the
 *  overlay viewers' caps the box hugs the picture, so this is the box; in
 *  `fill` mode the box is the whole stage and the picture is letterboxed. */
function pictureBox(el: HTMLImageElement): { w: number; h: number } {
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (!el.naturalWidth || !el.naturalHeight || !w || !h) return { w, h };
  const ratio = el.naturalWidth / el.naturalHeight;
  const shownW = Math.min(w, h * ratio);
  return { w: shownW, h: shownW / ratio };
}

function isQuarterTurn(rotation: number): boolean {
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized === 90 || normalized === 270;
}
