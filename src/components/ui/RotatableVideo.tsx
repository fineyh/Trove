import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

interface RotatableVideoProps {
  src: string;
  /** The rotation transform style; applied to the `<video>` frame only. */
  style?: CSSProperties;
  autoPlay?: boolean;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Fullscreen video with view-only rotation. The native `controls` bar is part
 * of the `<video>` element's box, so rotating the element rotates the progress
 * bar too — which is wrong. Instead we hide native controls, apply the rotation
 * `style` to the frame only, and render our own control bar anchored to the
 * bottom of the viewport so it stays upright regardless of frame rotation.
 */
export function RotatableVideo({ src, style, autoPlay }: RotatableVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  // A fresh `src` (navigating between videos) resets our derived state.
  useEffect(() => {
    setPlaying(false);
    setDuration(0);
    setCurrentTime(0);
  }, [src]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const onSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const t = Number(e.target.value);
    v.currentTime = t;
    setCurrentTime(t);
  }, []);

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
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
      />

      <div
        className="fixed inset-x-0 bottom-6 z-20 flex justify-center px-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full max-w-2xl items-center gap-3 rounded-full bg-black/60 px-4 py-2.5 backdrop-blur">
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15"
            title={playing ? "暂停" : "播放"}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>

          <span className="shrink-0 text-xs tabular-nums text-white/80">
            {formatTime(currentTime)}
          </span>

          <input
            type="range"
            min={0}
            max={duration || 0}
            step="any"
            value={currentTime}
            onChange={onSeek}
            className="h-1 flex-1 cursor-pointer accent-white"
            title="进度"
          />

          <span className="shrink-0 text-xs tabular-nums text-white/80">
            {formatTime(duration)}
          </span>

          <button
            type="button"
            onClick={toggleMute}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15"
            title={muted ? "取消静音" : "静音"}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
      </div>
    </>
  );
}
