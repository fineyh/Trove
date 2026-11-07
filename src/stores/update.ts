import { create } from "zustand";
import * as ipc from "../ipc/client";
import { isTauri } from "../hooks/useIsTauri";
import { errText } from "../lib/errors";
import type { UpdateChannel, UpdateInfo } from "../types";

/**
 * Update checks (ADR-041). One store for the About page, the red dot on the
 * settings icon and the background check.
 *
 * Background check: once shortly after launch, then every 24 h while the app
 * stays open — only when `updateAuto` is on. It only asks GitHub for the
 * version manifest; failures are silent.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "downloading"; downloaded: number; total: number | null }
  | { kind: "installing" };

interface UpdateState {
  /** Result of the last successful check (manual or background). */
  info: UpdateInfo | null;
  phase: Phase;
  /** Error of the last check / install the user started. */
  error: string | null;
  channel: UpdateChannel;
  auto: boolean;
  lastCheck: number;
  check: (opts?: { silent?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  setChannel: (c: UpdateChannel) => Promise<void>;
  setAuto: (on: boolean) => Promise<void>;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  info: null,
  phase: { kind: "idle" },
  error: null,
  channel: "stable",
  auto: true,
  lastCheck: 0,

  check: async ({ silent = false } = {}) => {
    const busy = get().phase.kind;
    if (busy !== "idle") return;
    set({ phase: { kind: "checking" }, ...(silent ? {} : { error: null }) });
    try {
      const info = await ipc.checkForUpdate();
      set({ info, lastCheck: info.checkedAt, phase: { kind: "idle" } });
    } catch (e) {
      set({ phase: { kind: "idle" } });
      if (silent) console.warn("background update check failed", e);
      else set({ error: errText(e) });
    }
  },

  install: async () => {
    if (get().phase.kind !== "idle") return;
    set({ phase: { kind: "downloading", downloaded: 0, total: null }, error: null });
    try {
      await ipc.installUpdate((ev) => {
        if (ev.event === "progress") {
          set({ phase: { kind: "downloading", downloaded: ev.downloaded, total: ev.total } });
        } else {
          set({ phase: { kind: "installing" } });
        }
      });
      // On success the app restarts before we get here.
    } catch (e) {
      set({ phase: { kind: "idle" }, error: errText(e) });
    }
  },

  setChannel: async (channel) => {
    await ipc.setUiPref("update_channel", channel);
    // The old result belongs to the other channel.
    set({ channel, info: null, error: null });
    await get().check();
  },

  setAuto: async (on) => {
    await ipc.setUiPref("update_auto", on ? "on" : "off");
    set({ auto: on });
  },
}));

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const FIRST_CHECK_DELAY = 10_000;

let started = false;

/** Load the update prefs and start the background check. Call once. */
export function initUpdates() {
  if (started || !isTauri()) return;
  started = true;
  void ipc
    .getUiPrefs()
    .then((p) => {
      useUpdateStore.setState({ channel: p.updateChannel, auto: p.updateAuto, lastCheck: p.updateLastCheck });
    })
    .catch(() => {});

  const tick = () => {
    const s = useUpdateStore.getState();
    if (s.auto) void s.check({ silent: true });
  };
  // Not right at launch: unlocking and the first scans come first. After that,
  // look hourly whether a day has passed (timers stall while the PC sleeps;
  // a failed check leaves lastCheck alone, so it retries the next hour).
  setTimeout(() => {
    tick();
    setInterval(() => {
      if (Date.now() - useUpdateStore.getState().lastCheck >= DAY) tick();
    }, HOUR);
  }, FIRST_CHECK_DELAY);
}
