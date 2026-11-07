import { Archive, Download, Info, ShieldCheck, Upload } from "lucide-react";
import { useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import * as ipc from "../../../ipc/client";
import { useSecurityStore } from "../../../stores/security";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Button, Notice, Switch, TextField } from "../../ui/Modal";
import { isTauri } from "../../../hooks/useIsTauri";
import { errText } from "../../../lib/errors";
import { formatBytes } from "../../../lib/media";
import type { BackupExportResult } from "../../../types";
import { MIN_PASSWORD } from "../../library/LibraryDialogs";

export function BackupPane() {
  const appPassword = useSecurityStore((s) => s.status?.appPassword === true);

  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<BackupExportResult | null>(null);
  const [pendingImportPath, setPendingImportPath] = useState<string | null>(null);
  const [withPassword, setWithPassword] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  const pwOk = !withPassword || (pw.length >= MIN_PASSWORD && pw === pw2);

  const handleExport = async () => {
    setError(null);
    setExported(null);
    if (!isTauri()) {
      setError("仅在桌面应用内可用");
      return;
    }
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const dest = await saveDialog({
        defaultPath: `trove-${stamp}.trovebackup`,
        filters: [{ name: "Trove Backup", extensions: ["trovebackup"] }],
      });
      if (!dest) return;
      setBusy("export");
      const result = await ipc.exportBackup(dest, withPassword && !appPassword ? pw : undefined);
      setExported(result);
      setPw("");
      setPw2("");
    } catch (e: unknown) {
      setError(errText(e));
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
      if (typeof src === "string") setPendingImportPath(src);
    } catch (e: unknown) {
      setError(errText(e));
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingImportPath) return;
    setBusy("import");
    setError(null);
    try {
      await ipc.importBackup(pendingImportPath);
      setPendingImportPath(null);
      // Restart so boot runs against the restored keyring and libraries.
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e: unknown) {
      setError(errText(e));
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">备份</h2>

      <Notice icon={<Info size={14} />}>
        备份只包含<b>目录和元数据</b>：所有库（会话、说明、缩略图）和钥匙环。
        <b>不含照片和视频原文件</b>，它们仍在原来的位置，需要另外备份。
      </Notice>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Download size={14} />
          导出
        </div>
        <div className="text-xs leading-5 text-app-muted">
          库文件本身就是加密的。没设启动密码时，拿到备份文件就能用 Trove 打开它，和拷走数据目录一样；
          设过密码的库仍然需要它自己的密码。
        </div>

        {appPassword ? (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <ShieldCheck size={14} />
            已设置启动密码：恢复这份备份时需要输入它。
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-app-border p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium">为这份备份设密码</span>
                <span className="text-xs text-app-muted">恢复时要输入它。只作用于这一份备份文件。</span>
              </div>
              <Switch checked={withPassword} onChange={setWithPassword} label="为备份设密码" />
            </div>
            {withPassword && (
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  type="password"
                  label="备份密码"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  error={pw.length > 0 && pw.length < MIN_PASSWORD ? `至少 ${MIN_PASSWORD} 个字符` : undefined}
                />
                <TextField
                  type="password"
                  label="再输入一次"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  error={pw2.length > 0 && pw !== pw2 ? "两次输入不一致" : undefined}
                />
              </div>
            )}
          </div>
        )}

        <Button
          variant="primary"
          icon={<Download size={14} />}
          onClick={handleExport}
          disabled={busy !== null || !pwOk}
          className="self-start"
        >
          {busy === "export" ? "导出中…" : "选择导出位置…"}
        </Button>
        {exported && (
          <Notice tone="success">
            已导出到 <span className="select-text break-all font-mono">{exported.destPath}</span>（
            {formatBytes(exported.bytes)}
            {exported.passwordProtected ? " · 有密码保护" : ""}）
          </Notice>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-app-border pt-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Upload size={14} />
          导入
        </div>
        <div className="text-xs leading-5 text-app-muted">
          用备份替换当前数据。当前数据不会被删除，而是移到
          <code className="mx-1 rounded bg-app-subtle px-1">&lt;数据目录&gt;/backups/&lt;时间戳&gt;/</code>
          ，导入后应用会自动重启。
        </div>
        <Button
          icon={<Archive size={14} />}
          onClick={handlePickImport}
          disabled={busy !== null}
          className="self-start"
        >
          选择 .trovebackup 文件…
        </Button>
      </section>

      {error && <Notice tone="danger">{error}</Notice>}

      <ConfirmDialog
        open={pendingImportPath !== null}
        variant="danger"
        title="导入备份"
        message={
          pendingImportPath ? (
            <div className="flex flex-col gap-2">
              <div>
                将用 <span className="break-all font-mono">{pendingImportPath}</span> 替换当前数据。
              </div>
              <div className="text-xs text-app-muted">
                当前数据会被移动到 backups/&lt;时间戳&gt;/ 目录，可手动找回。导入完成后应用会立即重启；
                如果备份设过密码，重启后会要求输入，它会成为启动密码（之后可以在「安全」里修改或去掉）。
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
