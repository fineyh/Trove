// Entry for the media popup windows (`player.html`). Shares the viewer pieces
// with the main window (RotatableVideo, useViewerTransform, tooltips, design
// tokens) but none of its stores: the popup gets a ready `trove://` URL by
// query string and only talks to its own window.

// Must stay first: fakes the Tauri runtime for browser previews (dev, ?mock only).
import "../dev/mockTauri";
import React from "react";
import ReactDOM from "react-dom/client";
import { TooltipLayer } from "../components/ui/Tooltip";
import { installNativeShell } from "../lib/nativeShell";
import { PlayerApp } from "./PlayerApp";
import "../styles.css";

installNativeShell();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PlayerApp />
    <TooltipLayer />
  </React.StrictMode>,
);
