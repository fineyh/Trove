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

const SKIP_SECONDS = 10;
const IDLE_MS = 2500;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function formatRate(rate: number): string {
  return (Number.isInteger(rate) ? `${rate}.0` : `${rate}`) + "×";
}

function setupVideoControls(video: HTMLVideoElement): void {
  const $ = (id: string): HTMLElement | null => document.getElementById(id);
  const bar = $("video-controls");
  if (!bar) return;
  bar.style.display = "flex";

  const iconPlay = $("vc-icon-play");
  const iconPause = $("vc-icon-pause");
  const cur = $("vc-current");
  const dur = $("vc-duration");
  const progress = $("vc-progress");
  const played = $("vc-played");
  const buffered = $("vc-buffered");
  const thumb = $("vc-thumb");
  const bubble = $("vc-bubble");
  const iconVol = $("vc-icon-vol");
  const iconVolLow = $("vc-icon-vol-low");
  const iconMuted = $("vc-icon-muted");
  const volume = $("vc-volume") as HTMLInputElement | null;
  const rateBtn = $("vc-rate");
  const rateMenu = $("vc-rate-menu");
  const spinner = $("vc-spinner");

  // --- Play / pause ---
  const syncPlay = (): void => {
    const playing = !video.paused;
    if (iconPlay) iconPlay.style.display = playing ? "none" : "block";
    if (iconPause) iconPause.style.display = playing ? "block" : "none";
  };
  const togglePlay = (): void => {
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  };
  $("vc-play")?.addEventListener("click", togglePlay);
  video.addEventListener("click", togglePlay);
  video.addEventListener("play", syncPlay);
  video.addEventListener("pause", syncPlay);
  video.addEventListener("ended", syncPlay);

  // --- ±10s skip ---
  const skip = (delta: number): void => {
    const dr = video.duration || 0;
    video.currentTime = Math.min(dr, Math.max(0, video.currentTime + delta));
  };
  $("vc-back")?.addEventListener("click", () => skip(-SKIP_SECONDS));
  $("vc-fwd")?.addEventListener("click", () => skip(SKIP_SECONDS));

  // --- Progress bar (played fill + buffered range + scrub + hover bubble) ---
  const renderProgress = (): void => {
    const dr = video.duration;
    if (!Number.isFinite(dr) || dr <= 0) return;
    const p = clamp01(video.currentTime / dr) * 100;
    if (played) played.style.width = `${p}%`;
    if (thumb) thumb.style.left = `${p}%`;
  };
  const renderBuffered = (): void => {
    const dr = video.duration;
    if (Number.isFinite(dr) && dr > 0 && video.buffered.length && buffered) {
      const end = video.buffered.end(video.buffered.length - 1);
      buffered.style.width = `${clamp01(end / dr) * 100}%`;
    }
  };
  const ratioAt = (clientX: number): number => {
    if (!progress) return 0;
    const rect = progress.getBoundingClientRect();
    return clamp01((clientX - rect.left) / rect.width);
  };
  const seekTo = (clientX: number): void => {
    const dr = video.duration;
    if (!Number.isFinite(dr) || dr <= 0) return;
    video.currentTime = ratioAt(clientX) * dr;
    renderProgress();
  };
  let scrubbing = false;
  progress?.addEventListener("pointerdown", (e) => {
    scrubbing = true;
    progress.setPointerCapture(e.pointerId);
    seekTo(e.clientX);
  });
  progress?.addEventListener("pointermove", (e) => {
    const dr = video.duration;
    if (bubble && Number.isFinite(dr) && dr > 0) {
      const r = ratioAt(e.clientX);
      bubble.style.left = `${r * 100}%`;
      bubble.textContent = formatTime(r * dr);
      bubble.style.display = "block";
    }
    if (scrubbing) seekTo(e.clientX);
  });
  progress?.addEventListener("pointerup", (e) => {
    scrubbing = false;
    progress.releasePointerCapture(e.pointerId);
  });
  progress?.addEventListener("pointerleave", () => {
    if (bubble) bubble.style.display = "none";
  });

  video.addEventListener("loadedmetadata", () => {
    if (dur) dur.textContent = formatTime(video.duration);
    renderProgress();
  });
  video.addEventListener("timeupdate", () => {
    if (cur) cur.textContent = formatTime(video.currentTime);
    renderProgress();
  });
  video.addEventListener("progress", renderBuffered);

  // --- Volume ---
  const renderVolume = (): void => {
    const v = video.muted ? 0 : video.volume;
    if (volume) volume.value = String(v);
    if (iconVol) iconVol.style.display = v >= 0.5 ? "block" : "none";
    if (iconVolLow) iconVolLow.style.display = v > 0 && v < 0.5 ? "block" : "none";
    if (iconMuted) iconMuted.style.display = v === 0 ? "block" : "none";
  };
  volume?.addEventListener("input", () => {
    const val = Number(volume.value);
    video.volume = val;
    video.muted = val === 0;
    renderVolume();
  });
  const toggleMute = (): void => {
    if (!video.muted && video.volume === 0) video.volume = 1;
    video.muted = !video.muted;
    renderVolume();
  };
  $("vc-mute")?.addEventListener("click", toggleMute);
  video.addEventListener("volumechange", renderVolume);

  // --- Playback rate ---
  const setRate = (r: number): void => {
    video.playbackRate = r;
    if (rateBtn) rateBtn.textContent = formatRate(r);
    rateMenu?.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.rate) === r);
    });
  };
  rateBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    rateMenu?.classList.toggle("open");
  });
  rateMenu?.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      setRate(Number(b.dataset.rate));
      rateMenu.classList.remove("open");
    });
  });
  document.addEventListener("click", (e) => {
    if (rateMenu && !rateMenu.contains(e.target as Node) && e.target !== rateBtn) {
      rateMenu.classList.remove("open");
    }
  });

  // --- Fullscreen ---
  const iconFsEnter = $("vc-icon-fs-enter");
  const iconFsExit = $("vc-icon-fs-exit");
  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  };
  $("vc-fullscreen")?.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => {
    const fs = !!document.fullscreenElement;
    if (iconFsEnter) iconFsEnter.style.display = fs ? "none" : "block";
    if (iconFsExit) iconFsExit.style.display = fs ? "block" : "none";
  });

  // --- Buffering spinner ---
  video.addEventListener("waiting", () => {
    if (spinner) spinner.style.display = "block";
  });
  const hideSpinner = (): void => {
    if (spinner) spinner.style.display = "none";
  };
  video.addEventListener("playing", hideSpinner);
  video.addEventListener("canplay", hideSpinner);

  // --- Auto-hide bar + cursor while idle during playback ---
  let idleTimer: number | undefined;
  const armIdle = (): void => {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (!video.paused) document.body.classList.add("idle");
    }, IDLE_MS);
  };
  window.addEventListener("mousemove", () => {
    document.body.classList.remove("idle");
    armIdle();
  });
  video.addEventListener("play", armIdle);
  video.addEventListener("pause", () => {
    window.clearTimeout(idleTimer);
    document.body.classList.remove("idle");
  });

  // --- Keyboard: Space = play/pause, M = mute ---
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.isContentEditable)) return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "m" || e.key === "M") {
      toggleMute();
    } else if (e.key === "f" || e.key === "F") {
      toggleFullscreen();
    }
  });

  syncPlay();
  renderVolume();
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
