import { useEffect, useState } from "react";
import * as ipc from "../../../ipc/client";
import { isTauri } from "../../../hooks/useIsTauri";
import { errText } from "../../../lib/errors";
import type { UpdateInfo } from "../../../types";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/Notice";
import { Group, Page, Row } from "../SettingsKit";
import appIcon from "../../../../src-tauri/icons/128x128@2x.png";

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
      setCheck({ kind: "result", info: await ipc.checkForUpdate() });
    } catch (e: unknown) {
      setCheck({ kind: "error", message: errText(e) });
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await ipc.installUpdate();
    } catch (e: unknown) {
      setCheck({ kind: "error", message: errText(e) });
      setInstalling(false);
    }
  };

  const available = check.kind === "result" && check.info.available ? check.info : null;

  return (
    <Page title="关于">
      <div className="flex items-center gap-4 px-1">
        <img src={appIcon} alt="" className="h-14 w-14" draggable={false} />
        <div className="flex flex-col">
          <span className="text-base font-semibold">Trove</span>
          <span className="text-xs text-app-muted">版本 {version}</span>
        </div>
      </div>

      <Group title="更新">
        <Row
          label={available ? `新版本 ${available.latestVersion}` : "软件更新"}
          description={
            check.kind === "checking"
              ? "正在检查…"
              : check.kind === "result" && !check.info.available
                ? "已是最新版本"
                : available?.date
                  ? `发布于 ${available.date}`
                  : undefined
          }
          expanded={
            available?.notes ? (
              <pre className="selectable max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-app-subtle px-3 py-2 font-sans text-xs text-app-secondary">
                {available.notes}
              </pre>
            ) : undefined
          }
        >
          {available ? (
            <Button variant="primary" size="sm" onClick={handleInstall} loading={installing}>
              下载并安装
            </Button>
          ) : (
            <Button size="sm" onClick={handleCheck} loading={check.kind === "checking"}>
              检查更新
            </Button>
          )}
        </Row>
      </Group>

      {check.kind === "error" && <Notice tone="danger">{check.message}</Notice>}
    </Page>
  );
}
