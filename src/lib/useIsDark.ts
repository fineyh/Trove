import { useEffect, useState } from "react";

/** Whether the app is in its dark theme right now (follows the `dark` class on <html>). */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const root = document.documentElement;
    const mo = new MutationObserver(() => setDark(root.classList.contains("dark")));
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}
