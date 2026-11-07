import { create } from "zustand";
import * as ipc from "../ipc/client";
import type { ThemePref } from "../ipc/client";

interface ThemeState {
  pref: ThemePref;
  set: (pref: ThemePref) => Promise<void>;
}

const media = window.matchMedia("(prefers-color-scheme: dark)");

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
}

export const useThemeStore = create<ThemeState>((set) => ({
  pref: "system",
  set: async (pref) => {
    apply(pref);
    set({ pref });
    await ipc.setUiPref("theme", pref);
  },
}));

/** Apply the system theme at once, then the saved one. Call before render. */
export function initTheme() {
  apply("system");
  media.addEventListener("change", () => apply(useThemeStore.getState().pref));
  void ipc
    .getUiPrefs()
    .then(({ theme }) => {
      useThemeStore.setState({ pref: theme });
      apply(theme);
    })
    .catch(() => {});
}
