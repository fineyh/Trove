// Recordings (ADR-058): one shared <audio> for the whole main window, so only
// one plays at a time and it keeps playing while the list scrolls or the
// conversation changes. Switching or locking the library stops it.

import { create } from "zustand";
import * as ipc from "../ipc/client";
import { toast } from "./toast";

export interface AudioTrack {
  lib: string;
  messageId: number;
  mediaId: number;
  convId: number;
  title: string;
  durationMs: number | null;
}

const RATES = [1, 1.5, 2] as const;

interface AudioState {
  track: AudioTrack | null;
  playing: boolean;
  posMs: number;
  /** From the element once it knows; else the track's. */
  durationMs: number | null;
  rate: number;
  /** Start `t`, or toggle it if it is the one loaded. `at` (0–1) jumps there. */
  play: (t: AudioTrack, at?: number) => void;
  toggle: () => void;
  seek: (at: number) => void;
  cycleRate: () => void;
  stop: () => void;
}

let el: HTMLAudioElement | null = null;

/** The shared element; read by the view tracker. */
export function audioElement(): HTMLAudioElement {
  if (el) return el;
  const a = new Audio();
  a.preload = "auto";
  const get = useAudioStore.getState;
  const set = useAudioStore.setState;
  a.addEventListener("play", () => set({ playing: true }));
  a.addEventListener("pause", () => set({ playing: false }));
  a.addEventListener("timeupdate", () => {
    if (get().track) set({ posMs: Math.round(a.currentTime * 1000) });
  });
  a.addEventListener("loadedmetadata", () => {
    if (get().track && Number.isFinite(a.duration)) set({ durationMs: Math.round(a.duration * 1000) });
  });
  // Played to the end: put away, like a voice message.
  a.addEventListener("ended", () => get().stop());
  a.addEventListener("error", () => {
    const t = get().track;
    if (!t || !a.getAttribute("src")) return;
    // A format the WebView can't play (AMR, WMA): hand it to the system.
    get().stop();
    void ipc
      .openMedia(t.lib, t.mediaId)
      .then(() => toast.info("已用默认应用打开"))
      .catch((e) => toast.error("无法播放", e));
  });
  el = a;
  return a;
}

/** Seek once the element knows the length. */
function seekTo(a: HTMLAudioElement, at: (duration: number) => number) {
  const go = () => {
    if (Number.isFinite(a.duration)) a.currentTime = Math.max(0, Math.min(at(a.duration), a.duration - 0.05));
  };
  if (a.readyState >= 1) go();
  else a.addEventListener("loadedmetadata", go, { once: true });
}

const same = (a: AudioTrack | null, b: AudioTrack) => a !== null && a.lib === b.lib && a.messageId === b.messageId;

export const useAudioStore = create<AudioState>((set, get) => ({
  track: null,
  playing: false,
  posMs: 0,
  durationMs: null,
  rate: 1,

  play: (t, at) => {
    const a = audioElement();
    if (same(get().track, t)) {
      if (at !== undefined) {
        seekTo(a, (d) => d * at);
        if (a.paused) void a.play().catch(() => {});
      } else get().toggle();
      return;
    }
    a.pause();
    a.dataset.message = String(t.messageId);
    a.src = ipc.mediaSrc(t.lib, t.mediaId);
    a.playbackRate = get().rate;
    set({ track: t, playing: false, posMs: 0, durationMs: t.durationMs });
    if (at !== undefined) {
      seekTo(a, (d) => d * at);
      void a.play().catch(() => {});
      return;
    }
    // Pick a long recording up where it was left.
    void ipc
      .statsResumePos(t.lib, t.messageId)
      .catch(() => null)
      .then((ms) => {
        if (!same(get().track, t)) return;
        if (ms) {
          seekTo(a, () => ms / 1000);
          set({ posMs: ms });
        }
        void a.play().catch(() => {});
      });
  },

  toggle: () => {
    const a = audioElement();
    if (!get().track) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  },

  seek: (at) => {
    if (!get().track) return;
    seekTo(audioElement(), (d) => d * at);
  },

  cycleRate: () => {
    const next = RATES[(RATES.indexOf(get().rate as (typeof RATES)[number]) + 1) % RATES.length];
    audioElement().playbackRate = next;
    // A new src resets the rate to default; `play` sets it again.
    set({ rate: next });
  },

  stop: () => {
    if (!get().track) return;
    const a = audioElement();
    a.pause();
    a.removeAttribute("src");
    delete a.dataset.message;
    a.load();
    set({ track: null, playing: false, posMs: 0, durationMs: null });
  },
}));

export function trackOf(lib: string, m: { id: number; convId: number; caption: string | null; media: { id: number; durationMs: number | null } | null }): AudioTrack | null {
  if (!m.media) return null;
  return { lib, messageId: m.id, mediaId: m.media.id, convId: m.convId, title: m.caption ?? "录音", durationMs: m.media.durationMs };
}
