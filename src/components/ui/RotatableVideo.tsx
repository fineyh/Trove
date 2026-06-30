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

interface RotatableVideoProps {
  src: string;
  /** The rotation transform style; applied to the `<video>` frame only. */
  style?: CSSProperties;
  autoPlay?: boolean;
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

function formatRate(rate: number): string {
  return Number.isInteger(rate) ? `${rate}.0×` : `${rate}×`;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Fullscreen video with view-only rotation and a custom control bar. The native
 * `controls` bar is part of the `<video>` element's box, so rotating the
 * element rotates the progress bar too — which is wrong. Instead we hide native
 * controls, apply the rotation `style` to the frame only, and render our own
 * bar anchored to the bottom of the viewport so it stays upright regardless of
 * frame rotation.
 *
 * The bar carries a full player toolset: play/pause, ±10s skip, a scrubbable
 * progress bar with buffered range and hover time bubble, current/total time, a
 * playback-rate menu, and a hover-to-reveal volume slider. It auto-hides (along
 * with the cursor) after the mouse goes idle during playback.
 */
export function RotatableVideo({ src, style, autoPlay }: RotatableVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

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

  // Fullscreen the whole viewer (not just the <video>) so our control bar,
  // rotation buttons and pager stay usable. `documentElement` works for both
  // the in-app overlay (fixed inset-0) and any host that mounts this component.
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen().catch(() => {});
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

  return (
    <>
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        className="object-contain"
        style={style}
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          applyMediaPrefs();
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onProgress={(e) => {
          const b = e.currentTarget.buffered;
          if (b.length) setBufferedEnd(b.end(b.length - 1));
        }}
      />

      {waiting && (
        <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center">
          <Loader2 size={44} className="animate-spin text-white/80" />
        </div>
      )}

      <div
        className={`fixed inset-x-0 bottom-6 z-20 flex justify-center px-4 transition-opacity duration-300 ${
          chromeVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={(e) => e.stopPropagation()}
        onPointerEnter={() => {
          hoveringBarRef.current = true;
        }}
        onPointerLeave={() => {
          hoveringBarRef.current = false;
        }}
      >
        <div className="flex w-full max-w-3xl items-center gap-2 rounded-full bg-black/60 px-4 py-2.5 backdrop-blur">
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15"
            title={playing ? "暂停 (空格)" : "播放 (空格)"}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>

          <button
            type="button"
            onClick={() => skip(-SKIP_SECONDS)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15"
            title="后退 10 秒"
          >
            <Rewind size={16} />
          </button>
          <button
            type="button"
            onClick={() => skip(SKIP_SECONDS)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15"
            title="快进 10 秒"
          >
            <FastForward size={16} />
          </button>

          <span className="shrink-0 text-xs tabular-nums text-white/80">
            {formatTime(currentTime)}
          </span>

          <div
            ref={trackRef}
            className="group relative flex h-4 flex-1 cursor-pointer items-center touch-none"
            onPointerDown={onTrackPointerDown}
            onPointerMove={onTrackPointerMove}
            onPointerUp={onTrackPointerUp}
            onPointerLeave={() => {
              if (!seeking) setHoverRatio(null);
            }}
          >
            <div className="relative h-1 w-full rounded-full bg-white/25 transition-[height] group-hover:h-1.5">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/35"
                style={{ width: `${bufferedPct}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white"
                style={{ width: `${playedPct}%` }}
              />
              <div
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover:opacity-100"
                style={{ left: `${playedPct}%` }}
              />
            </div>
            {hoverRatio !== null && duration > 0 && (
              <div
                className="pointer-events-none absolute bottom-5 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] tabular-nums text-white"
                style={{ left: `${hoverRatio * 100}%` }}
              >
                {formatTime(hoverRatio * duration)}
              </div>
            )}
          </div>

          <span className="shrink-0 text-xs tabular-nums text-white/80">
            {formatTime(duration)}
          </span>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setRateOpen((o) => !o)}
              className="flex h-9 min-w-[3rem] items-center justify-center rounded-full px-2 text-xs tabular-nums text-white hover:bg-white/15"
              title="播放速度"
            >
              {formatRate(rate)}
            </button>
            {rateOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setRateOpen(false);
                  }}
                />
                <div className="absolute bottom-full left-1/2 z-20 mb-2 flex -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-neutral-900/95 py-1 shadow-lg ring-1 ring-white/10">
                  {RATES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => changeRate(r)}
                      className={`px-4 py-1.5 text-center text-xs tabular-nums hover:bg-white/10 ${
                        r === rate ? "text-white" : "text-white/70"
                      }`}
                    >
                      {formatRate(r)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="group/vol relative shrink-0">
            <button
              type="button"
              onClick={toggleMute}
              className="flex h-9 w-9 items-center justify-center rounded-full text-white hover:bg-white/15"
              title={muted ? "取消静音 (M)" : "静音 (M)"}
            >
              <VolumeIcon size={18} />
            </button>
            <div className="absolute bottom-full left-1/2 hidden -translate-x-1/2 justify-center pb-2 group-hover/vol:flex">
              <div className="flex items-center rounded-full bg-neutral-900/95 px-2.5 py-3 shadow-lg ring-1 ring-white/10">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={onVolumeInput}
                  className="trove-volume"
                  title="音量"
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15"
            title={fullscreen ? "退出全屏 (F)" : "全屏 (F)"}
          >
            {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>
    </>
  );
}
