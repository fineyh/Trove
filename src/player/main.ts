// Video player window entry, loaded by `player.html` in its own frameless
// Tauri WebviewWindow. Kept lean: no stores / vault / app IPC — it
// only talks to the window API for the custom title-bar controls (pin toggle,
// close) and to resize itself to the video's real dimensions.
//
// The video source arrives pre-built (already a `convertFileSrc` asset URL)
// via the `src` query param; `title` labels the window.

import {
  LogicalSize,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";

/** Must match `--titlebar-h` in player.html and PLAYER_TITLEBAR_HEIGHT. */
const TITLEBAR_HEIGHT = 32;
/** Don't let the popup exceed this fraction of the monitor's work area. */
const MAX_SCREEN_FRACTION = 0.9;

const params = new URLSearchParams(location.search);
const src = params.get("src");
const title = params.get("title");

const win = getCurrentWindow();

const titleEl = document.getElementById("title");
if (titleEl && title) titleEl.textContent = title;
if (title) document.title = title;

// --- Title-bar controls -----------------------------------------------------

const pinBtn = document.getElementById("pin");
let pinned = false;
pinBtn?.addEventListener("click", () => {
  pinned = !pinned;
  pinBtn.classList.toggle("active", pinned);
  void win.setAlwaysOnTop(pinned);
});

document.getElementById("close")?.addEventListener("click", () => {
  void win.close();
});

// --- Video + resize-to-actual-size ------------------------------------------

const video = document.getElementById("player") as HTMLVideoElement | null;

/** Resize the window so the video shows at its native pixel size, clamped to
 *  the current monitor's work area while preserving aspect ratio. */
async function fitToVideo(w: number, h: number): Promise<void> {
  if (!w || !h) return;
  try {
    const mon = await currentMonitor();
    if (mon) {
      const maxW = (mon.size.width / mon.scaleFactor) * MAX_SCREEN_FRACTION;
      const maxH =
        (mon.size.height / mon.scaleFactor) * MAX_SCREEN_FRACTION -
        TITLEBAR_HEIGHT;
      const scale = Math.min(1, maxW / w, maxH / h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    await win.setSize(new LogicalSize(w, h + TITLEBAR_HEIGHT));
  } catch {
    /* sizing is best-effort */
  }
}

if (video && src) {
  video.addEventListener(
    "loadedmetadata",
    () => void fitToVideo(video.videoWidth, video.videoHeight),
    { once: true },
  );
  video.src = src;
  // Autoplay may be blocked for a freshly opened window with no user
  // activation; `controls` is the fallback so the user can hit play.
  void video.play().catch(() => {});
}
