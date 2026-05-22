import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { isTauri } from "../../../hooks/useIsTauri";

export function AboutPane() {
  const [version, setVersion] = useState<string>("—");

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void import("@tauri-apps/api/app").then(async (mod) => {
      try {
        const v = await mod.getVersion();
        if (!cancelled) setVersion(v);
      } catch (e) {
        console.error("getVersion failed", e);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">关于</h2>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-3 rounded-md border border-app-border bg-app-subtle/30 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-app-accent/10 text-app-accent">
            <Info size={20} />
          </div>
          <div className="flex flex-col">
            <div className="text-sm font-medium">Trove</div>
            <div className="text-xs text-app-muted">版本 {version}</div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="text-sm font-medium">检查更新</div>
        <div className="rounded-md border border-dashed border-app-border bg-app-subtle/30 px-4 py-6 text-center text-xs text-app-muted">
          将在 Phase 6 通过 Tauri updater 提供。
        </div>
      </section>
    </div>
  );
}
