import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { Toaster } from "./components/ui/Toaster";
import { installGlobalErrorHandlers } from "./lib/globalErrors";
import "./styles.css";

installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Toaster 是 ErrorBoundary 的兄弟而不是子节点：App 整棵树崩掉时提示还在，
        而且 UnlockScreen 那条早返回分支也能弹 toast。 */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <Toaster />
  </React.StrictMode>,
);
