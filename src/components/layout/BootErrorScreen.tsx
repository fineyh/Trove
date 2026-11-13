import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import * as ipc from "../../ipc/client";
import { useSecurityStore } from "../../stores/security";
import { errText } from "../../lib/errors";
import { isTauri } from "../../hooks/useIsTauri";
import type { BootErrorKind } from "../../types";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Notice } from "../ui/Notice";
import { DragStrip } from "../ui/WindowControls";
import appIcon from "../../../src-tauri/icons/128x128@2x.png";

/** One sentence per cause: what happened, then what to do. The raw error
 *  stays under 详细信息. */
const SUMMARY: Record<BootErrorKind, string> = {
  keyring_missing: "数据目录中缺少 keyring.json，无法打开库。请将该文件放回原位置，或从备份恢复。",
  keyring_damaged: "keyring.json 已损坏，自动修复失败。请从备份恢复。",
  newer_version: "数据由更高版本的 Trove 创建。请安装最新版本后重试。",
  library_unreadable: "库文件无法打开，可能已损坏。请从备份恢复。",
  data_dir: "无法访问数据目录。请检查磁盘空间和文件夹权限。",
  other: "启动过程中出现错误。",
};

/** Startup failed (R4.1, ADR-045). The backend has no session, so this
 *  screen only offers what works without one: open the data folder,
 *  restore a backup, retry. */
export function BootErrorScreen() {
  const bootError = useSecurityStore((s) => s.bootError);
  const [showDetail, setShowDetail] = useState(false);
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!bootError) return null;

  const relaunch = async () => {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  };

  const openFolder = () => {
    setError(null);
    void ipc.openPath(bootError.dataDir).catch((e) => setError(errText(e)));
  };

  const pickBackup = async () => {
    setError(null);
    if (!isTauri()) return;
    try {
      const src = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "Trove 备份", extensions: ["trovebackup"] }],
      });
      if (typeof src === "string") setPendingImport(src);
    } catch (e) {
      setError(errText(e));
    }
  };

  const restore = async () => {
    if (!pendingImport) return;
    setBusy(true);
    setError(null);
    try {
      await ipc.importBackup(pendingImport);
      await relaunch();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
      setPendingImport(null);
    }
  };

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-app">
      <DragStrip />
      <div className="flex w-full max-w-[440px] animate-pop-in flex-col items-center gap-6 px-6">
        <img src={appIcon} alt="" className="h-16 w-16" draggable={false} />
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="text-lg font-semibold">Trove 无法启动</div>
          <div className="text-sm text-app-secondary [text-wrap:balance]">{SUMMARY[bootError.kind] ?? SUMMARY.other}</div>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={openFolder}>打开数据目录</Button>
          <Button onClick={pickBackup} disabled={busy}>
            从备份恢复…
          </Button>
          <Button variant="primary" onClick={() => void relaunch()} disabled={busy}>
            重试
          </Button>
        </div>

        {error && <Notice tone="danger">{error}</Notice>}

        <div className="flex w-full flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="flex items-center gap-1 text-xs text-app-muted hover:text-app-secondary"
          >
            {showDetail ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            详细信息
          </button>
          {showDetail && (
            <div className="selectable max-h-40 w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-app-subtle px-3 py-2 font-mono text-2xs text-app-secondary">
              {bootError.detail}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingImport !== null}
        variant="danger"
        title="从备份恢复"
        message={
          <div className="flex flex-col gap-2">
            <span>现有数据将移至数据目录下的 backups 文件夹，随后 Trove 会重新启动。</span>
            <span className="selectable break-all font-mono text-xs text-app-muted">{pendingImport}</span>
          </div>
        }
        confirmText="恢复并重启"
        busy={busy}
        onConfirm={restore}
        onCancel={() => setPendingImport(null)}
      />
    </div>
  );
}
