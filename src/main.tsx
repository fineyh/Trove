// Must stay first: fakes the Tauri runtime before any store loads (dev, ?mock only).
import "./dev/mockTauri";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { Toaster } from "./components/ui/Toaster";
import { TooltipLayer } from "./components/ui/Tooltip";
import { installNativeShell } from "./lib/nativeShell";
import { initTheme } from "./stores/theme";
import { initUpdates } from "./stores/update";
import { installGlobalErrorHandlers } from "./lib/globalErrors";
import "./styles.css";

installGlobalErrorHandlers();
installNativeShell();
initTheme();
initUpdates();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Toaster 是 ErrorBoundary 的兄弟而不是子节点：App 整棵树崩掉时提示还在，
        而且 UnlockScreen 那条早返回分支也能弹 toast。 */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <Toaster />
    <TooltipLayer />
  </React.StrictMode>,
);
