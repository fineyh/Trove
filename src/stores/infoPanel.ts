import { create } from "zustand";
import { getUiPrefs, setUiPref } from "../ipc/client";

/** Whether the viewers show the info panel (ADR-062). Remembered in `ui.json`:
 *  the WebView keeps no storage of its own (ADR-037). Closed by default. */
interface InfoPanelState {
  open: boolean;
  loaded: boolean;
  load: () => void;
  toggle: () => void;
}

export const useInfoPanelStore = create<InfoPanelState>((set, get) => ({
  open: false,
  loaded: false,
  load: () => {
    if (get().loaded) return;
    set({ loaded: true });
    void getUiPrefs()
      .then((p) => set({ open: p.infoPanel }))
      .catch(() => {});
  },
  toggle: () => {
    const open = !get().open;
    set({ open });
    void setUiPref("info_panel", open ? "on" : "off").catch(() => {});
  },
}));

/** The width the panel takes, in the viewers and docked beside the chat. */
export const INFO_PANEL_WIDTH = 320;
