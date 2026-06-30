// Media viewer window entry, loaded by `player.html` in its own frameless
// Tauri WebviewWindow. Handles both video and image popups. Kept lean: no
// stores / vault / app IPC — it only talks to the window API for the custom
// title-bar controls (pin toggle, close) and to resize itself to the media's
// real dimensions.
//
// The media source arrives pre-built (already a `convertFileSrc` asset URL)
// via the `src` query param; `title` labels the window; `kind` is
// "video" | "image".

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
const kind = params.get("kind") ?? "video";
const isHeic = params.get("heic") === "1";

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

// --- Media + resize-to-actual-size ------------------------------------------

/** Resize the window so the media shows at its native pixel size, clamped to
 *  the current monitor's work area while preserving aspect ratio. */
async function fitToContent(w: number, h: number): Promise<void> {
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

// --- Rotation (temporary, view-only — never touches the file) ---------------

let activeEl: HTMLElement | null = null;
let naturalW = 0;
let naturalH = 0;
let rotation = 0;

/** Re-fit the popup and the media element to the current rotation. The window
 *  is resized to the rotated aspect; the element's max-size constraints swap at
 *  a quarter turn so the rotated media still fills the window without overflow. */
function applyLayout(): void {
  if (!activeEl || !naturalW || !naturalH) return;
  activeEl.style.transform = `rotate(${rotation}deg)`;
  const quarter = ((((rotation % 360) + 360) % 360) % 180) !== 0;
  if (quarter) {
    activeEl.style.maxWidth = `calc(100vh - ${TITLEBAR_HEIGHT}px)`;
    activeEl.style.maxHeight = "100vw";
    void fitToContent(naturalH, naturalW);
  } else {
    activeEl.style.maxWidth = "100vw";
    activeEl.style.maxHeight = `calc(100vh - ${TITLEBAR_HEIGHT}px)`;
    void fitToContent(naturalW, naturalH);
  }
}

document.getElementById("rotate-left")?.addEventListener("click", () => {
  rotation -= 90;
  applyLayout();
});
document.getElementById("rotate-right")?.addEventListener("click", () => {
  rotation += 90;
  applyLayout();
});

// --- Load the media ---------------------------------------------------------

if (kind === "image") {
  const image = document.getElementById("image") as HTMLImageElement | null;
  if (image && src) {
    image.style.display = "block";
    activeEl = image;
    image.addEventListener(
      "load",
      () => {
        naturalW = image.naturalWidth;
        naturalH = image.naturalHeight;
        applyLayout();
      },
      { once: true },
    );
    if (isHeic) {
      // WebView can't decode HEIC; convert to a JPEG blob URL first. heic-to
      // (and its WASM) is dynamically imported so plain images don't pay for it.
      void import("../lib/heic")
        .then(({ decodeHeicToUrl }) => decodeHeicToUrl(src, src))
        .then((url) => {
          image.src = url;
        })
        .catch(() => {
          if (titleEl) titleEl.textContent = "此格式无法预览";
        });
    } else {
      image.src = src;
    }
  }
} else {
  const video = document.getElementById("player") as HTMLVideoElement | null;
  if (video && src) {
    video.style.display = "block";
    activeEl = video;
    video.addEventListener(
      "loadedmetadata",
      () => {
        naturalW = video.videoWidth;
        naturalH = video.videoHeight;
        applyLayout();
      },
      { once: true },
    );
    video.src = src;
    // Autoplay may be blocked for a freshly opened window with no user
    // activation; `controls` is the fallback so the user can hit play.
    void video.play().catch(() => {});
  }
}
