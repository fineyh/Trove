import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import * as ipc from "../../../ipc/client";
import { errText } from "../../../lib/errors";
import { useSecurityStore } from "../../../stores/security";
import { useSessionStore } from "../../../stores/session";
import { useSettingsStore } from "../../../stores/settings";
import { toast } from "../../../stores/toast";
import type { IdleLockMinutes } from "../../../types";
import { MIN_PASSWORD } from "../../library/LibraryDialogs";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/Field";
import { Notice } from "../../ui/Notice";
import { Select } from "../../ui/Select";
import { Switch } from "../../ui/Switch";
import { Group, Page, Row } from "../SettingsKit";

type Action = null | "set" | "change" | "remove" | "recovery";

const IDLE_OPTIONS: { value: IdleLockMinutes; label: string }[] = [
  { value: 0, label: "从不" },
  { value: 5, label: "5 分钟后" },
  { value: 15, label: "15 分钟后" },
  { value: 30, label: "30 分钟后" },
  { value: 60, label: "1 小时后" },
];

export function SecurityPane() {
  const status = useSecurityStore((s) => s.status);
  const sec = useSecurityStore.getState;
  const showRecovery = useSessionStore((s) => s.showRecovery);
  const idle = useSettingsStore((s) => s.settings.idleLockMinutes);
  const save = useSettingsStore((s) => s.save);

  const [action, setAction] = useState<Action>(null);
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purgeScheduled, setPurgeScheduled] = useState(false);

  if (!status) return null;
  const has = status.appPassword;
  const pairOk = pw.length >= MIN_PASSWORD && pw === pw2;

  const begin = (a: Action) => {
    setAction(action === a ? null : a);
    setCurrent("");
    setPw("");
    setPw2("");
    setError(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setWorking(true);
    setError(null);
    try {
      await fn();
      setAction(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setWorking(false);
    }
  };

  const pair = (
    <div className="grid grid-cols-2 gap-3">
      <TextField
        type="password"
        label={action === "change" ? "新密码" : "密码"}
        value={pw}
        autoFocus={action === "set"}
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
  );

  const currentField = (
    <TextField type="password" label="当前密码" value={current} autoFocus onChange={(e) => setCurrent(e.target.value)} />
  );

  const form = (fields: React.ReactNode, label: string, ready: boolean, onConfirm: () => void, danger = false) => (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !working) onConfirm();
      }}
    >
      {fields}
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={() => begin(null)} disabled={working}>
          取消
        </Button>
        <Button type="submit" variant={danger ? "danger" : "primary"} disabled={!ready} loading={working}>
          {label}
        </Button>
      </div>
    </form>
  );

  return (
    <Page title="隐私与安全">
      <Group title="应用锁">
        <Row
          label="应用锁"
          description="打开 Trove 时需要输入密码"
          expanded={
            action === "set"
              ? form(pair, "开启", pairOk, () =>
                  run(async () => {
                    const code = await sec().setPassword(pw);
                    showRecovery({ code, target: "Trove" });
                  }),
                )
              : action === "remove"
                ? form(
                    currentField,
                    "关闭应用锁",
                    current.length > 0,
                    () =>
                      run(async () => {
                        await sec().removePassword(current);
                        toast.success("应用锁已关闭");
                      }),
                    true,
                  )
                : undefined
          }
        >
          <Switch
            label="应用锁"
            checked={has ? action !== "remove" : action === "set"}
            onChange={() => begin(has ? "remove" : "set")}
          />
        </Row>
        {has && (
          <Row
            label="应用密码"
            expanded={
              action === "change"
                ? form(
                    <>
                      {currentField}
                      {pair}
                    </>,
                    "更改",
                    current.length > 0 && pairOk,
                    () =>
                      run(async () => {
                        await sec().changePassword(current, pw);
                        toast.success("应用密码已更改");
                      }),
                  )
                : undefined
            }
          >
            <Button size="sm" onClick={() => begin("change")}>
              更改
            </Button>
          </Row>
        )}
        {has && (
          <Row
            label="恢复密钥"
            description={status.appRecovery ? "忘记密码时用它解锁" : "未生成，忘记密码将无法打开 Trove"}
            expanded={
              action === "recovery"
                ? form(currentField, status.appRecovery ? "重新生成" : "生成", current.length > 0, () =>
                    run(async () => {
                      const code = await sec().resetRecovery(current);
                      showRecovery({ code, target: "Trove" });
                    }),
                  )
                : undefined
            }
          >
            <Button size="sm" onClick={() => begin("recovery")}>
              {status.appRecovery ? "重新生成" : "生成"}
            </Button>
          </Row>
        )}
        <Row label="自动锁定" description={has ? "一段时间无操作后锁定" : "应用锁关闭时，只锁定有密码的库"}>
          <Select
            label="自动锁定"
            value={idle}
            options={IDLE_OPTIONS}
            onChange={(v) => void save("idleLockMinutes", v).catch((e) => toast.error("设置没有保存", e))}
          />
        </Row>
      </Group>

      {status.legacyProblem && (
        <Notice tone="warn" icon={<AlertTriangle size={14} />}>
          {status.legacyProblem}
        </Notice>
      )}

      <Group title="清理">
        {status.legacyPlainCopy && (
          <Row label="升级前的明文数据库" description="确认数据完整后可以删除">
            <Button
              size="sm"
              variant="danger-secondary"
              onClick={() =>
                void ipc
                  .deleteLegacyCopy()
                  .then(() => sec().refresh())
                  .then(() => toast.success("已删除"))
                  .catch((e) => toast.error("删除失败", e))
              }
            >
              删除
            </Button>
          </Row>
        )}
        <Row label="界面缓存" description="旧版本在这里记录过媒体路径">
          <Button
            size="sm"
            disabled={purgeScheduled}
            onClick={() =>
              void ipc
                .scheduleWebviewPurge()
                .then(() => setPurgeScheduled(true))
                .catch((e) => toast.error("操作失败", e))
            }
          >
            {purgeScheduled ? "将在下次启动时清除" : "下次启动时清除"}
          </Button>
        </Row>
      </Group>
    </Page>
  );
}
