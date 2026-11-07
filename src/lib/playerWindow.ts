import {
  WebviewWindow,
  getAllWebviewWindows,
} from "@tauri-apps/api/webviewWindow";
import type { Message } from "../types";
import { mediaSrc } from "../ipc/client";
import { currentLib } from "../stores/libraries";
import { useMessagesStore } from "../stores/messages";
import { isHeicExt } from "./heic";
import { isImageMedia } from "./media";
import { PLAYER_TITLEBAR_HEIGHT } from "../player/layout";

/** Label prefix for every media (video/image) popup window. */
export const PLAYER_LABEL_PREFIX = "player-";

// Fallback popup size used only until the player reads the media's real
// dimensions (video `loadedmetadata` / image `load`) and resizes itself to
// the actual size.
const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 360;
/** Cap the *initial* width so a known-huge video doesn't spawn off-screen
 *  (the player clamps to the monitor afterwards anyway). */
const INITIAL_MAX_WIDTH = 1280;
/** Pixel step for cascading successive popups so they don't fully overlap. */
const CASCADE_STEP = 32;

/**
 * Open a video or image in its own standalone popup window. Each media item
 * gets a dedicated `WebviewWindow` loading the lightweight `player.html`;
 * re-invoking for an already-open item just refocuses it. The media URL is
 * passed pre-built (`trove://`, ids only) via query string, so the popup needs no
 * IPC.
 */
export async function openPlayerWindow(message: Message): Promise<void> {
  if (!message.media) return;
  const kind =
    message.media.kind === "video" ? "video" : isImageMedia(message.media) ? "image" : null;
  if (!kind) return;

  const lib = currentLib();
  // Ids are per library, so the label names both.
  const label = `${PLAYER_LABEL_PREFIX}${lib}-${message.id}`;

  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.unminimize().catch(() => {});
    await existing.setFocus().catch(() => {});
    return;
  }

  // An id-only trove:// URL: no path ever reaches the popup (ADR-037).
  const src = mediaSrc(lib, message.media.id);
  const title =
    message.caption?.trim() || (kind === "image" ? "Trove 图片" : "Trove 视频");
  const params = new URLSearchParams({ src, title, kind });
  // Flag HEIC so the player decodes it (WebView can't show HEIC natively).
  if (kind === "image" && isHeicExt(message.media.ext)) {
    params.set("heic", "1");
  }
  const query = params.toString();

  // Initial size hint from known media dimensions (video size is often null
  // until ffmpeg probing lands; images usually have it); the player resizes to
  // the true size once the media loads.
  let initW = DEFAULT_WIDTH;
  let initH = DEFAULT_HEIGHT;
  if (message.media.width && message.media.height) {
    const scale = Math.min(1, INITIAL_MAX_WIDTH / message.media.width);
    initW = Math.round(message.media.width * scale);
    initH = Math.round(message.media.height * scale);
  }

  // Cascade new popups off the count of windows already open.
  const offset =
    ((await getAllWebviewWindows()).filter((w) =>
      w.label.startsWith(PLAYER_LABEL_PREFIX),
    ).length %
      8) *
    CASCADE_STEP;

  new WebviewWindow(label, {
    url: `player.html?${query}`,
    title,
    width: initW,
    height: initH + PLAYER_TITLEBAR_HEIGHT,
    decorations: false,
    // Like the main window: no history or disk cache (ADR-037).
    incognito: true,
    resizable: true,
    // Not always-on-top by default — the player exposes a pin toggle instead.
    x: 120 + offset,
    y: 120 + offset,
  });

  // Mirror Lightbox: opening a video counts as a play (images aren't counted).
  if (kind === "video") {
    void useMessagesStore.getState().registerPlay(message.id);
  }
}

/** Close every media popup window (e.g. when the main window is closing). */
export async function closeAllPlayerWindows(): Promise<void> {
  const wins = await getAllWebviewWindows();
  await Promise.all(
    wins
      .filter((w) => w.label.startsWith(PLAYER_LABEL_PREFIX))
      .map((w) => w.close().catch(() => {})),
  );
}
