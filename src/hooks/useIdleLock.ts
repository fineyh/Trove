// Idle auto-lock (ADR-036 §6). After N minutes without input:
//   - with a startup password: lock the whole app;
//   - otherwise: lock encrypted libraries opened by password / recovery code
//     (key-file ones follow their file, not the clock).
// Without either there is nothing to lock, and the timer does nothing.

import { useEffect } from "react";
import * as ipc from "../ipc/client";
import { useLibrariesStore } from "../stores/libraries";
import { useSecurityStore } from "../stores/security";
import { useSettingsStore } from "../stores/settings";

const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

export function useIdleLock(): void {
  const minutes = useSettingsStore((s) => s.settings.idleLockMinutes);

  useEffect(() => {
    if (minutes === 0) return;
    const limit = minutes * 60_000;
    let last = Date.now();
    const bump = () => {
      last = Date.now();
    };
    for (const ev of EVENTS) window.addEventListener(ev, bump, { passive: true });

    const timer = window.setInterval(() => {
      if (Date.now() - last < limit) return;
      last = Date.now();
      if (useSecurityStore.getState().status?.appPassword) {
        void useSecurityStore.getState().lock().catch(() => {});
        return;
      }
      const libs = useLibrariesStore.getState().list.filter(
        (l) => l.encrypted && l.unlocked && (l.unlockedBy === "password" || l.unlockedBy === "recovery"),
      );
      if (libs.length === 0) return;
      void Promise.all(libs.map((l) => ipc.lockLibrary(l.id).catch(() => {}))).then(() =>
        useLibrariesStore.getState().refresh(),
      );
    }, 15_000);

    return () => {
      window.clearInterval(timer);
      for (const ev of EVENTS) window.removeEventListener(ev, bump);
    };
  }, [minutes]);
}
