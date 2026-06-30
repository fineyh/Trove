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

// --- Custom video controls --------------------------------------------------

// Native `<video controls>` renders its progress bar inside the element box, so
// rotating the frame rotates the controls too. Instead we drive our own control
// bar that's anchored to the window bottom (see #video-controls in player.html)
// and stays upright no matter how the frame is rotated.

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function setupVideoControls(video: HTMLVideoElement): void {
  const bar = document.getElementById("video-controls");
  const playBtn = document.getElementById("vc-play");
  const iconPlay = document.getElementById("vc-icon-play");
  const iconPause = document.getElementById("vc-icon-pause");
  const seek = document.getElementById("vc-seek") as HTMLInputElement | null;
  const cur = document.getElementById("vc-current");
  const dur = document.getElementById("vc-duration");
  const muteBtn = document.getElementById("vc-mute");
  const iconVol = document.getElementById("vc-icon-vol");
  const iconMuted = document.getElementById("vc-icon-muted");
  if (!bar) return;
  bar.style.display = "flex";

  const syncPlay = (): void => {
    const playing = !video.paused;
    if (iconPlay) iconPlay.style.display = playing ? "none" : "block";
    if (iconPause) iconPause.style.display = playing ? "block" : "none";
  };
  const togglePlay = (): void => {
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  };

  playBtn?.addEventListener("click", togglePlay);
  video.addEventListener("click", togglePlay);
  video.addEventListener("play", syncPlay);
  video.addEventListener("pause", syncPlay);
  video.addEventListener("ended", syncPlay);

  video.addEventListener("loadedmetadata", () => {
    if (seek) seek.max = String(video.duration || 0);
    if (dur) dur.textContent = formatTime(video.duration);
  });
  video.addEventListener("timeupdate", () => {
    if (seek) seek.value = String(video.currentTime);
    if (cur) cur.textContent = formatTime(video.currentTime);
  });
  seek?.addEventListener("input", () => {
    video.currentTime = Number(seek.value);
  });

  muteBtn?.addEventListener("click", () => {
    video.muted = !video.muted;
    if (iconVol) iconVol.style.display = video.muted ? "none" : "block";
    if (iconMuted) iconMuted.style.display = video.muted ? "block" : "none";
  });
}

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
    setupVideoControls(video);
    video.src = src;
    // Autoplay may be blocked for a freshly opened window with no user
    // activation; the custom control bar is the fallback so the user can hit play.
    void video.play().catch(() => {});
  }
}
