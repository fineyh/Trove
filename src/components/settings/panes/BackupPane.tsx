import { Archive, Download, Upload } from "lucide-react";
import { useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import * as ipc from "../../../ipc/client";
import { useVaultStore } from "../../../stores/vault";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { isTauri } from "../../../hooks/useIsTauri";
import type { BackupExportResult } from "../../../types";

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
}

export function BackupPane() {
  const vaultStatus = useVaultStore((s) => s.status);
  const vaultLocked = vaultStatus.hasMasterPassword && !vaultStatus.unlocked;

  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<BackupExportResult | null>(null);
  const [pendingImportPath, setPendingImportPath] = useState<string | null>(null);

  const handleExport = async () => {
    setError(null);
    setExported(null);
    if (!isTauri()) {
      setError("仅在桌面应用内可用");
      return;
    }
    try {
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const dest = await saveDialog({
        defaultPath: `trove-${stamp}.trovebackup`,
        filters: [{ name: "Trove Backup", extensions: ["trovebackup"] }],
      });
      if (!dest) return;
      setBusy("export");
      const result = await ipc.exportBackup(dest);
      setExported(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handlePickImport = async () => {
    setError(null);
    if (!isTauri()) {
      setError("仅在桌面应用内可用");
      return;
    }
    try {
      const src = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "Trove Backup", extensions: ["trovebackup"] }],
      });
      if (typeof src === "string") {
        setPendingImportPath(src);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingImportPath) return;
    setBusy("import");
    setError(null);
    try {
      const result = await ipc.importBackup(pendingImportPath);
      setPendingImportPath(null);
      // success → relaunch so vault/init can run cleanly
      const { relaunch } = await import("@tauri-apps/plugin-process");
      console.info(
        `Trove backup restored from ${pendingImportPath}; previous data preserved at ${result.backupDir}`,
      );
      await relaunch();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">备份</h2>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Download size={14} />
          导出
        </div>
        <div className="text-xs text-app-muted">
          打包当前数据库（加密会话保留加密）、缩略图与
          <code className="mx-1 rounded bg-app-subtle px-1">vault.json</code>
          为单个 <code className="mx-1 rounded bg-app-subtle px-1">.trovebackup</code>
          文件。
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={busy !== null || vaultLocked}
          className="flex w-fit items-center gap-1.5 rounded-md bg-app-accent px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-40"
        >
          <Download size={12} />
          {busy === "export" ? "导出中..." : "选择导出位置"}
        </button>
        {exported && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600">
            已导出到 <span className="font-mono">{exported.destPath}</span>（
            {formatBytes(exported.bytes)}
            {exported.dbEncrypted ? " · 加密 DB" : ""}）
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-app-border pt-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Upload size={14} />
          导入
        </div>
        <div className="text-xs text-app-muted">
          覆盖当前数据。原数据会自动保存到
          <code className="mx-1 rounded bg-app-subtle px-1">
            &lt;数据目录&gt;/backups/&lt;时间戳&gt;/
          </code>
          。导入成功后会自动重启。
        </div>
        <button
          type="button"
          onClick={handlePickImport}
          disabled={busy !== null}
          className="flex w-fit items-center gap-1.5 rounded-md border border-app-border px-3 py-1.5 text-xs hover:bg-app-subtle disabled:opacity-40"
        >
          <Archive size={12} />
          选择 .trovebackup 文件...
        </button>
      </section>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {error}
        </div>
      )}

      <ConfirmDialog
        open={pendingImportPath !== null}
        variant="danger"
        title="导入备份"
        message={
          pendingImportPath ? (
            <div className="flex flex-col gap-2">
              <div>
                将用 <span className="font-mono">{pendingImportPath}</span>{" "}
                覆盖当前数据。
              </div>
              <div className="text-xs text-app-muted">
                当前数据会被移动到 backups/&lt;时间戳&gt;/ 目录，可手动找回。
                导入完成后应用会立即重启。
              </div>
            </div>
          ) : (
            ""
          )
        }
        confirmText="导入并重启"
        busy={busy === "import"}
        onConfirm={handleConfirmImport}
        onCancel={() => setPendingImportPath(null)}
      />
    </div>
  );
}
