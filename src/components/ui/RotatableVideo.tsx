import {
  FastForward,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  Rewind,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { cn } from "../../lib/cn";
import { useEscapeLayer } from "./Modal";

interface RotatableVideoProps {
  src: string;
  /** The rotation transform style; applied to the `<video>` frame only. */
  style?: CSSProperties;
  /** Signed multiple of 90 from `useViewerTransform`; lets fullscreen swap the fill
   *  caps at a quarter turn so a rotated clip still fills the screen. */
  rotation?: number;
  autoPlay?: boolean;
  /** The clip's pixel size, once known (the player window sizes itself to it). */
  onNaturalSize?: (width: number, height: number) => void;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SKIP_SECONDS = 10;
/** Hide the bar + cursor after this much mouse idle while playing. */
const IDLE_MS = 2500;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? m.toString().padStart(2, "0") : m.toString();
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const formatRate = (rate: number) => `${rate}×`;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Icon button on the bar. Colors are tokens under the bar's `dark` scope. */
const BAR_BUTTON =
  "flex h-8 shrink-0 items-center justify-center rounded-lg text-app-fg transition-colors duration-fast hover:bg-app-hover/10 active:bg-app-hover/15";
const POPOVER =
  "rounded-xl bg-app-panel shadow-lg ring-1 ring-app-border animate-menu-in";

/**
 * Video with view-only rotation and a custom control bar, used by the Lightbox,
 * the map viewer and the player window. The native `controls` bar is part of
 * the `<video>` element's box, so rotating the element rotates the progress
 * bar too — which is wrong. Instead we hide native controls, apply the
 * rotation `style` to the frame only, and render our own bar anchored to the
 * bottom of the viewport so it stays upright regardless of frame rotation.
 *
 * The bar carries play/pause, ±10s skip, a scrubbable progress bar with
 * buffered range and hover time, current/total time, a playback-rate menu and a
 * hover-to-reveal volume slider. It auto-hides (with the cursor) after the
 * mouse goes idle during playback.
 *
 * The whole component sits in a `dark` scope: it is always drawn over black,
 * whatever the app theme, so the tokens resolve to their dark values here.
 */
export function RotatableVideo(
  { src, style, rotation = 0, autoPlay, onNaturalSize }: RotatableVideoProps,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rateRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [rate, setRate] = useState(1);
  const [rateOpen, setRateOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  // Latest values the idle timer needs without re-arming its listeners.
  const playingRef = useRef(false);
  const hoveringBarRef = useRef(false);
  playingRef.current = playing;

  // A fresh `src` (navigating between videos) resets per-clip state. Volume,
  // mute and rate are deliberately preserved across clips as user preferences.
  useEffect(() => {
    setPlaying(false);
    setDuration(0);
    setCurrentTime(0);
    setBufferedEnd(0);
    setWaiting(false);
    setRateOpen(false);
    setHoverRatio(null);
  }, [src]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    // Unmuting a clip that's at zero volume should make sound audible again.
    if (!v.muted && v.volume === 0) {
      v.volume = 1;
      setVolume(1);
    }
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const skip = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    const next = clamp01((v.currentTime + delta) / (v.duration || 1)) *
      (v.duration || 0);
    v.currentTime = next;
    setCurrentTime(next);
  }, []);

  const onVolumeInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = videoRef.current;
      if (!v) return;
      const val = Number(e.target.value);
      v.volume = val;
      v.muted = val === 0;
      setVolume(val);
      setMuted(val === 0);
    },
    [],
  );

  const changeRate = useCallback((r: number) => {
    const v = videoRef.current;
    if (v) v.playbackRate = r;
    setRate(r);
    setRateOpen(false);
  }, []);

  // Rate menu: Esc closes the menu (not the viewer behind it), and so does a
  // press anywhere else. A full-screen backdrop can't do the latter here: the
  // bar's `backdrop-filter` makes it the containing block of `fixed`
  // descendants, so the backdrop would only cover the bar.
  useEscapeLayer(rateOpen, () => setRateOpen(false));
  useEffect(() => {
    if (!rateOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!rateRef.current?.contains(e.target as Node)) setRateOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [rateOpen]);

  // True "video fullscreen": fullscreen only the stage (frame + control bar),
  // not the whole document. The picture then fills the screen and the viewer's
  // surrounding chrome (close / rotate / pager, or the player's title bar,
  // which live outside the stage) naturally drops away.
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void stageRef.current?.requestFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Re-apply the chosen rate after metadata loads (a new `src` resets it to 1).
  const applyMediaPrefs = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rate;
    v.volume = volume;
    v.muted = muted;
  }, [rate, volume, muted]);

  // --- Scrubbing --------------------------------------------------------------

  const seekToClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      const v = videoRef.current;
      if (!el || !v) return;
      const dur = v.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      const rect = el.getBoundingClientRect();
      const ratio = clamp01((clientX - rect.left) / rect.width);
      v.currentTime = ratio * dur;
      setCurrentTime(ratio * dur);
    },
    [],
  );

  const onTrackPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setSeeking(true);
      seekToClientX(e.clientX);
    },
    [seekToClientX],
  );

  const onTrackPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = trackRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        setHoverRatio(clamp01((e.clientX - rect.left) / rect.width));
      }
      if (seeking) seekToClientX(e.clientX);
    },
    [seeking, seekToClientX],
  );

  const onTrackPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      setSeeking(false);
    },
    [],
  );

  // --- Keyboard shortcuts -----------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.isContentEditable)) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "m" || e.key === "M") {
        toggleMute();
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, toggleMute, toggleFullscreen]);

  // --- Auto-hide bar + cursor while idle during playback ----------------------

  useEffect(() => {
    let timer: number | undefined;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (playingRef.current && !hoveringBarRef.current) setChromeVisible(false);
      }, IDLE_MS);
    };
    const wake = () => {
      setChromeVisible(true);
      arm();
    };
    window.addEventListener("mousemove", wake);
    arm();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
    };
  }, []);

  // Pausing always reveals the bar; resuming re-arms the idle countdown.
  useEffect(() => {
    if (!playing) setChromeVisible(true);
  }, [playing]);

  // Hide the OS cursor together with the bar (restored on cleanup).
  useEffect(() => {
    const hidden = !chromeVisible && playing;
    document.body.style.cursor = hidden ? "none" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [chromeVisible, playing]);

  const playedPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? clamp01(bufferedEnd / duration) * 100 : 0;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  // In fullscreen the frame must FILL the screen. `max-width/height` only cap the
  // element, so a clip smaller than the monitor stayed at its native resolution.
  // Set an explicit width/height instead (swapped at a quarter turn) and let the
  // `object-contain` class scale the picture up with letterboxing. Keep only the
  // rotation transform/transition from the viewer's style; drop its size caps
  // so nothing fights the fill size.
  const normalized = ((rotation % 360) + 360) % 360;
  const quarterTurned = normalized === 90 || normalized === 270;
  const videoStyle: CSSProperties | undefined = fullscreen
    ? {
        transform: style?.transform,
        transition: style?.transition,
        width: quarterTurned ? "100vh" : "100vw",
        height: quarterTurned ? "100vw" : "100vh",
        maxWidth: "none",
        maxHeight: "none",
      }
    : style;

  return (
    <div
      ref={stageRef}
      className={cn(
        // shrink-0: a quarter-turned frame is taller or wider than its stage
        // on purpose; flex must not squeeze it back.
        "dark flex shrink-0 items-center justify-center",
        fullscreen && "h-screen w-screen overflow-hidden bg-black",
      )}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        className="shrink-0 object-contain"
        style={videoStyle}
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDuration(v.duration);
          applyMediaPrefs();
          if (v.videoWidth && v.videoHeight) onNaturalSize?.(v.videoWidth, v.videoHeight);
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onProgress={(e) => {
          const b = e.currentTarget.buffered;
          if (b.length) setBufferedEnd(b.end(b.length - 1));
        }}
      />

      {waiting && (
        <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center">
          <Loader2 size={28} className="animate-spin text-app-fg/70" />
        </div>
      )}

      <div
        className={cn(
          "fixed inset-x-0 bottom-5 z-20 flex justify-center px-4 transition-opacity duration-slow",
          chromeVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={(e) => e.stopPropagation()}
        onPointerEnter={() => {
          hoveringBarRef.current = true;
        }}
        onPointerLeave={() => {
          hoveringBarRef.current = false;
        }}
      >
        <div className="flex w-full max-w-3xl items-center gap-1 rounded-xl bg-app/80 p-1.5 shadow-lg ring-1 ring-app-border backdrop-blur-md">
          <button
            type="button"
            onClick={togglePlay}
            className={cn(BAR_BUTTON, "w-8")}
            aria-label={playing ? "暂停" : "播放"}
            data-tip={playing ? "暂停  空格" : "播放  空格"}
            data-tip-side="top"
          >
            {playing ? (
              <Pause size={16} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={16} fill="currentColor" strokeWidth={0} />
            )}
          </button>
          <button
            type="button"
            onClick={() => skip(-SKIP_SECONDS)}
            className={cn(BAR_BUTTON, "w-8")}
            aria-label="后退 10 秒"
            data-tip="后退 10 秒"
            data-tip-side="top"
          >
            <Rewind size={16} />
          </button>
          <button
            type="button"
            onClick={() => skip(SKIP_SECONDS)}
            className={cn(BAR_BUTTON, "w-8")}
            aria-label="快进 10 秒"
            data-tip="快进 10 秒"
            data-tip-side="top"
          >
            <FastForward size={16} />
          </button>

          <span className="min-w-[2.5rem] shrink-0 pl-1 text-right text-xs tabular-nums text-app-secondary">
            {formatTime(currentTime)}
          </span>

          <div
            ref={trackRef}
            className="group relative mx-2 flex h-6 flex-1 touch-none items-center"
            onPointerDown={onTrackPointerDown}
            onPointerMove={onTrackPointerMove}
            onPointerUp={onTrackPointerUp}
            onPointerLeave={() => {
              if (!seeking) setHoverRatio(null);
            }}
          >
            <div className="relative h-1 w-full rounded-full bg-app-fg/20 transition-[height] duration-fast group-hover:h-1.5">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-app-fg/25"
                style={{ width: `${bufferedPct}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-app-fg"
                style={{ width: `${playedPct}%` }}
              />
              <div
                className={cn(
                  "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-app-fg shadow transition-opacity duration-fast",
                  seeking ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                style={{ left: `${playedPct}%` }}
              />
            </div>
            {hoverRatio !== null && duration > 0 && (
              <div
                className="pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 rounded-md bg-app-panel px-1.5 py-0.5 text-2xs tabular-nums text-app-fg shadow-md ring-1 ring-app-border"
                style={{ left: `${hoverRatio * 100}%` }}
              >
                {formatTime(hoverRatio * duration)}
              </div>
            )}
          </div>

          <span className="min-w-[2.5rem] shrink-0 pr-1 text-xs tabular-nums text-app-secondary">
            {formatTime(duration)}
          </span>

          <div ref={rateRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setRateOpen((o) => !o)}
              className={cn(BAR_BUTTON, "min-w-[2.75rem] px-2 text-xs font-medium tabular-nums")}
              aria-label="播放速度"
              data-tip={rateOpen ? undefined : "播放速度"}
              data-tip-side="top"
            >
              {formatRate(rate)}
            </button>
            {rateOpen && (
              <div
                className={cn(
                  POPOVER,
                  "absolute bottom-full left-1/2 z-20 mb-2 flex w-20 -translate-x-1/2 flex-col p-1",
                )}
              >
                {RATES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => changeRate(r)}
                    className={cn(
                      "h-7 rounded-lg text-xs tabular-nums transition-colors duration-fast hover:bg-app-hover/10",
                      r === rate ? "font-medium text-app-accent" : "text-app-fg",
                    )}
                  >
                    {formatRate(r)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="group/vol relative shrink-0">
            <button
              type="button"
              onClick={toggleMute}
              className={cn(BAR_BUTTON, "w-8")}
              aria-label={muted ? "取消静音" : "静音"}
              data-tip={muted ? "取消静音  M" : "静音  M"}
              data-tip-side="top"
            >
              <VolumeIcon size={16} />
            </button>
            {/* The padding bridges the gap so the pointer can travel from the
                button up to the slider without the popover closing. */}
            <div className="absolute bottom-full left-1/2 hidden -translate-x-1/2 pb-2 group-hover/vol:flex">
              <div className={cn(POPOVER, "flex items-center px-2 py-3")}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={onVolumeInput}
                  className="trove-volume"
                  aria-label="音量"
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleFullscreen}
            className={cn(BAR_BUTTON, "w-8")}
            aria-label={fullscreen ? "退出全屏" : "全屏"}
            data-tip={fullscreen ? "退出全屏  F" : "全屏  F"}
            data-tip-side="top"
          >
            {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
