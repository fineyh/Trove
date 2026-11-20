// Recordings in the message list (ADR-058): the bubble, the bar that stays
// at the top while one plays, and the tracker that records listening.

import { useRef } from "react";
import { Pause, Play, X } from "lucide-react";
import type { Message } from "../../types";
import { audioElement, trackOf, useAudioStore } from "../../stores/audio";
import { useLibrariesStore } from "../../stores/libraries";
import { useViewTracker } from "../../lib/viewTracker";
import { formatDuration, messageTitle } from "../../lib/media";
import { cn } from "../../lib/cn";
import { IconButton } from "../ui/Button";

const BARS = 44;

/** `peaks` folded to `n` bars, 0–1, scaled to the loudest so quiet rooms still show. */
function bars(peaks: number[] | undefined, n: number): number[] {
  if (!peaks || peaks.length === 0) return Array(n).fill(0);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * peaks.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * peaks.length) / n));
    let m = 0;
    for (let j = a; j < b; j++) m = Math.max(m, peaks[j]);
    out.push(m);
  }
  const top = Math.max(...out);
  return top > 0 ? out.map((v) => v / top) : out;
}

function Waveform({
  peaks,
  progress,
  onSeek,
}: {
  peaks: number[] | undefined;
  /** 0–1 played; bars before it take the accent. */
  progress: number;
  onSeek: (at: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const values = bars(peaks, BARS);
  return (
    <div
      ref={ref}
      role="slider"
      aria-label="进度"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={-1}
      onClick={(e) => {
        const r = ref.current!.getBoundingClientRect();
        onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
      }}
      className="flex h-7 cursor-pointer items-center gap-[2px]"
    >
      {values.map((v, i) => (
        <span
          key={i}
          className={cn(
            "w-[2px] flex-1 rounded-full transition-colors duration-fast",
            (i + 0.5) / BARS <= progress ? "bg-app-accent" : "bg-app-secondary/35",
          )}
          // Without bars yet: a flat dotted line, still clickable.
          style={{ height: `${Math.max(3, Math.round(v * 28))}px` }}
        />
      ))}
    </div>
  );
}

export function AudioMessage({ message }: { message: Message }) {
  const lib = useLibrariesStore((s) => s.current);
  const media = message.media!;
  const id = message.id;
  const isCurrent = useAudioStore((s) => s.track !== null && s.track.lib === lib && s.track.messageId === id);
  const playing = useAudioStore((s) => s.playing && s.track?.messageId === id && s.track.lib === lib);
  const posMs = useAudioStore((s) => (s.track?.messageId === id && s.track.lib === lib ? s.posMs : 0));
  const liveDuration = useAudioStore((s) => (s.track?.messageId === id && s.track.lib === lib ? s.durationMs : null));
  const rate = useAudioStore((s) => s.rate);
  const play = useAudioStore((s) => s.play);
  const cycleRate = useAudioStore((s) => s.cycleRate);

  const duration = liveDuration ?? media.durationMs;
  const progress = isCurrent && duration ? posMs / duration : 0;
  const start = (at?: number) => {
    const t = lib ? trackOf(lib, message) : null;
    if (t) play(t, at);
  };

  return (
    <div className="flex w-72 items-center gap-3 rounded-xl border border-app-border bg-app-panel p-2.5 pr-3.5">
      <button
        type="button"
        aria-label={playing ? "暂停" : "播放"}
        onClick={() => start()}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-app-accent text-white transition-[filter] duration-fast hover:brightness-110"
      >
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Waveform peaks={media.peaks} progress={progress} onSeek={(at) => start(at)} />
        <div className="flex items-center gap-1.5 text-2xs leading-4 text-app-muted">
          {(isCurrent || duration) && (
            <span className="shrink-0 tabular-nums">{formatDuration(isCurrent ? posMs : duration!)}</span>
          )}
          <span className="min-w-0 flex-1 truncate">{messageTitle(message)}</span>
          {isCurrent && (
            <button
              type="button"
              onClick={cycleRate}
              className="shrink-0 rounded px-1 font-medium tabular-nums text-app-secondary hover:bg-app-hover/5"
            >
              {rate}×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Under the conversation header while a recording is loaded, from any conversation. */
export function AudioBar() {
  const track = useAudioStore((s) => s.track);
  const playing = useAudioStore((s) => s.playing);
  const posMs = useAudioStore((s) => s.posMs);
  const durationMs = useAudioStore((s) => s.durationMs);
  const rate = useAudioStore((s) => s.rate);
  const toggle = useAudioStore((s) => s.toggle);
  const cycleRate = useAudioStore((s) => s.cycleRate);
  const stop = useAudioStore((s) => s.stop);
  if (!track) return null;
  const progress = durationMs ? Math.min(1, posMs / durationMs) : 0;
  return (
    <div className="relative flex h-10 shrink-0 items-center gap-2 border-b border-app-border px-3">
      <IconButton
        size="sm"
        label={playing ? "暂停" : "播放"}
        icon={playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        onClick={toggle}
        className="text-app-accent hover:text-app-accent"
      />
      <span className="min-w-0 flex-1 truncate text-sm">{track.title}</span>
      <span className="shrink-0 text-xs tabular-nums text-app-muted">
        {formatDuration(posMs)}
        {durationMs ? ` / ${formatDuration(durationMs)}` : ""}
      </span>
      <button
        type="button"
        onClick={cycleRate}
        className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium tabular-nums text-app-secondary hover:bg-app-hover/5"
      >
        {rate}×
      </button>
      <IconButton size="sm" label="关闭" icon={<X size={14} />} onClick={stop} />
      <span className="absolute bottom-0 left-0 h-[2px] bg-app-accent" style={{ width: `${progress * 100}%` }} />
    </div>
  );
}

/** Records listening to whatever recording is loaded. Mounted once. */
export function AudioTracker() {
  const lib = useAudioStore((s) => s.track?.lib ?? "");
  const messageId = useAudioStore((s) => s.track?.messageId ?? null);
  useViewTracker(lib, messageId, "audio", "inline", messageId === null ? null : audioElement());
  return null;
}
