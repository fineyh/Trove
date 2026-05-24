import { useEffect, useState } from "react";
import { Check, Download, Info, RefreshCw } from "lucide-react";
import * as ipc from "../../../ipc/client";
import { isTauri } from "../../../hooks/useIsTauri";
import type { UpdateInfo } from "../../../types";

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "result"; info: UpdateInfo }
  | { kind: "error"; message: string };

export function AboutPane() {
  const [version, setVersion] = useState<string>("—");
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });
  const [installing, setInstalling] = useState(false);

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

  const handleCheck = async () => {
    setCheck({ kind: "checking" });
    try {
      const info = await ipc.checkForUpdate();
      setCheck({ kind: "result", info });
    } catch (e: unknown) {
      setCheck({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await ipc.installUpdate();
    } catch (e: unknown) {
      setCheck({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
      setInstalling(false);
    }
  };

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

      <section className="flex flex-col gap-3">
        <div className="text-sm font-medium">检查更新</div>
        <div className="text-xs text-app-muted">
          通过 GitHub Releases 的 latest.json 拉取。更新包带签名校验。
        </div>
        <button
          type="button"
          onClick={handleCheck}
          disabled={check.kind === "checking" || installing}
          className="flex w-fit items-center gap-1.5 rounded-md border border-app-border px-3 py-1.5 text-xs hover:bg-app-subtle disabled:opacity-40"
        >
          <RefreshCw
            size={12}
            className={check.kind === "checking" ? "animate-spin" : ""}
          />
          {check.kind === "checking" ? "正在检查..." : "立即检查更新"}
        </button>

        {check.kind === "result" && !check.info.available && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600">
            <Check size={12} />
            已是最新版本（{check.info.currentVersion}）
          </div>
        )}

        {check.kind === "result" && check.info.available && (
          <div className="flex flex-col gap-2 rounded-md border border-app-accent/30 bg-app-accent/10 p-3">
            <div className="text-sm font-medium">
              发现新版本 {check.info.latestVersion}
            </div>
            {check.info.date && (
              <div className="text-xs text-app-muted">
                发布于 {check.info.date}
              </div>
            )}
            {check.info.notes && (
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-app-panel p-2 text-xs text-app-fg/80">
                {check.info.notes}
              </pre>
            )}
            <button
              type="button"
              onClick={handleInstall}
              disabled={installing}
              className="flex w-fit items-center gap-1.5 rounded-md bg-app-accent px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-40"
            >
              <Download size={12} />
              {installing ? "下载并安装中..." : "下载并安装"}
            </button>
          </div>
        )}

        {check.kind === "error" && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
            {check.message}
          </div>
        )}
      </section>
    </div>
  );
}
