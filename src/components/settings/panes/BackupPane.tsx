import { useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import * as ipc from "../../../ipc/client";
import { useSecurityStore } from "../../../stores/security";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/Field";
import { Notice } from "../../ui/Notice";
import { Switch } from "../../ui/Switch";
import { isTauri } from "../../../hooks/useIsTauri";
import { errText } from "../../../lib/errors";
import { formatBytes } from "../../../lib/media";
import type { BackupExportResult } from "../../../types";
import { MIN_PASSWORD } from "../../library/LibraryDialogs";
import { Group, Page, Row } from "../SettingsKit";

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
    if (!isTauri()) return;
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const dest = await saveDialog({
        defaultPath: `trove-${stamp}.trovebackup`,
        filters: [{ name: "Trove 备份", extensions: ["trovebackup"] }],
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
    if (!isTauri()) return;
    try {
      const src = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "Trove 备份", extensions: ["trovebackup"] }],
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
    <Page title="备份与恢复">
      <Group title="备份" footer="包含所有库、会话和缩略图，不含照片和视频原文件。">
        {appPassword ? (
          <Row label="备份密码" description="与应用密码相同" />
        ) : (
          <Row
            label="备份密码"
            description="恢复时需要输入"
            expanded={
              withPassword ? (
                <div className="grid grid-cols-2 gap-3">
                  <TextField
                    type="password"
                    label="密码"
                    value={pw}
                    autoFocus
                    onChange={(e) => setPw(e.target.value)}
                    error={pw.length > 0 && pw.length < MIN_PASSWORD ? `至少 ${MIN_PASSWORD} 个字符` : undefined}
                  />
                  <TextField
                    type="password"
                    label="确认密码"
                    value={pw2}
                    onChange={(e) => setPw2(e.target.value)}
                    error={pw2.length > 0 && pw !== pw2 ? "两次输入不一致" : undefined}
                  />
                </div>
              ) : undefined
            }
          >
            <Switch checked={withPassword} onChange={setWithPassword} label="备份密码" />
          </Row>
        )}
        <Row
          label="导出备份"
          description={
            exported
              ? `已导出 ${formatBytes(exported.bytes)}${exported.passwordProtected ? "，有密码保护" : ""}`
              : undefined
          }
        >
          <Button variant="primary" size="sm" onClick={handleExport} disabled={busy !== null || !pwOk} loading={busy === "export"}>
            导出…
          </Button>
        </Row>
      </Group>

      <Group title="恢复">
        <Row label="从备份恢复" description="当前数据会先移到数据目录的 backups 文件夹">
          <Button size="sm" onClick={handlePickImport} disabled={busy !== null}>
            选择文件…
          </Button>
        </Row>
      </Group>

      {error && <Notice tone="danger">{error}</Notice>}

      <ConfirmDialog
        open={pendingImportPath !== null}
        variant="danger"
        title="从备份恢复"
        message={
          <div className="flex flex-col gap-2">
            <span>当前数据会被替换，Trove 随后重启。</span>
            <span className="selectable break-all font-mono text-xs text-app-muted">{pendingImportPath}</span>
          </div>
        }
        confirmText="恢复并重启"
        busy={busy === "import"}
        onConfirm={handleConfirmImport}
        onCancel={() => setPendingImportPath(null)}
      />
    </Page>
  );
}
