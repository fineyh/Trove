import { useCallback, useLayoutEffect, useState } from "react";
import type { CSSProperties } from "react";

/**
 * Temporary, view-only media rotation for the fullscreen viewers (Lightbox /
 * MapPhotoViewer). The original file is never touched — we only spin the
 * `<img>`/`<video>` element with a CSS transform.
 *
 * `rotation` is kept as an unbounded signed multiple of 90 so successive
 * clicks always animate the short, intuitive way (e.g. 270° → 360° spins
 * forward, not 270° back to 0°).
 *
 * Pass `resetKey` = whatever identifies the currently shown media (message id,
 * index, …); the rotation snaps back to upright whenever it changes. The reset
 * runs in a layout effect so the newly shown media never paints a stale angle.
 */
export function useRotation(resetKey: unknown) {
  const [rotation, setRotation] = useState(0);

  useLayoutEffect(() => {
    setRotation(0);
  }, [resetKey]);

  const rotateLeft = useCallback(() => setRotation((r) => r - 90), []);
  const rotateRight = useCallback(() => setRotation((r) => r + 90), []);

  // At a quarter turn the element's visual width/height swap, so swap the
  // max-size constraints too — this keeps the rotated media fully inside the
  // viewport with pure CSS, no need to read the media's pixel dimensions.
  const normalized = ((rotation % 360) + 360) % 360;
  const quarterTurned = normalized === 90 || normalized === 270;
  const mediaStyle: CSSProperties = {
    transform: `rotate(${rotation}deg)`,
    transition: "transform 150ms ease",
    maxWidth: quarterTurned ? "85vh" : "90vw",
    maxHeight: quarterTurned ? "90vw" : "85vh",
  };

  return { rotation, rotateLeft, rotateRight, mediaStyle };
}
