// React hook wrapping the HEIC decode primitives in `heic.ts`, which stays
// React-free (the thumbnail worker path uses it directly).

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, SyntheticEvent } from "react";
import { decodeHeicToUrl, isHeicExt } from "./heic";

export type ImageUrlStatus = "ready" | "loading" | "error";

export interface DisplayableImageUrl {
  url: string | null;
  status: ImageUrlStatus;
  /** Size the `<img>` with `previewStyle`: the thumbnail is still what's on
   *  screen (standing in while the original decodes, or until it has loaded). */
  preview: boolean;
  /** Wire to the `<img>`'s `onLoad`. */
  onLoad: (e: SyntheticEvent<HTMLImageElement>) => void;
}

/**
 * Resolve a displayable `<img>` src for the original file at `url`.
 *   - Non-HEIC: returns `url` immediately (`ready`).
 *   - HEIC: decodes, reporting `loading` then `ready` (blob URL) or `error`.
 *     With a `thumb`, that shows meanwhile (`ready` + `preview`), so a
 *     viewer opens on a picture rather than a spinner (ADR-060).
 * An empty `url` is a no-op, so the hook can run before data is there.
 */
export function useDisplayableImageUrl(
  url: string,
  ext: string,
  thumb?: string | null,
): DisplayableImageUrl {
  const heic = isHeicExt(ext);
  // `for` ties a result to the url it was decoded from, so moving to the
  // next photo never flashes the previous one.
  const [state, setState] = useState<{ for: string; url: string | null; status: ImageUrlStatus }>(
    () => ({ for: "", url: null, status: "loading" }),
  );

  // The src that has actually finished loading. Swapping src keeps the old
  // picture on screen until the new one is ready, so the box stays at full
  // size until then; switching it earlier showed the 320px thumbnail at its
  // own size for a moment.
  const [loaded, setLoaded] = useState<string | null>(null);
  const onLoad = useCallback(
    (e: SyntheticEvent<HTMLImageElement>) => setLoaded(e.currentTarget.getAttribute("src")),
    [],
  );

  useEffect(() => {
    if (!heic || !url) return;
    let cancelled = false;
    decodeHeicToUrl(url)
      .then((u) => {
        if (!cancelled) setState({ for: url, url: u, status: "ready" });
      })
      .catch(() => {
        if (!cancelled) setState({ for: url, url: null, status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [url, heic]);

  if (!heic || !url) return { url, status: "ready", preview: false, onLoad };
  if (state.for !== url) {
    return thumb
      ? { url: thumb, status: "ready", preview: true, onLoad }
      : { url: null, status: "loading", preview: false, onLoad };
  }
  const preview = !!thumb && state.status === "ready" && loaded !== state.url;
  return { url: state.url, status: state.status, preview, onLoad };
}

/**
 * Style for the thumbnail while it stands in: as big as the viewer lets the
 * picture be, so the photo appears at about its final size and the sharp one
 * simply replaces it. (A 320px thumbnail would otherwise show at 320px.)
 */
export function previewStyle(style: CSSProperties): CSSProperties {
  if (style.width !== undefined) return style;
  return { ...style, width: style.maxWidth, height: style.maxHeight };
}
