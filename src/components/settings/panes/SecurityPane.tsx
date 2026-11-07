import {
  AlertTriangle,
  Check,
  Eraser,
  KeyRound,
  LifeBuoy,
  Lock,
  ShieldCheck,
  ShieldOff,
  Timer,
} from "lucide-react";
import { useState } from "react";
import * as ipc from "../../../ipc/client";
import { cn } from "../../../lib/cn";
import { errText } from "../../../lib/errors";
import { useSecurityStore } from "../../../stores/security";
import { useSessionStore } from "../../../stores/session";
import { useSettingsStore } from "../../../stores/settings";
import { toast } from "../../../stores/toast";
import type { IdleLockMinutes } from "../../../types";
import { MIN_PASSWORD } from "../../library/LibraryDialogs";
import { Button, Notice, TextField } from "../../ui/Modal";

type Action = null | "set" | "change" | "remove" | "recovery";

const IDLE_OPTIONS: { value: IdleLockMinutes; label: string }[] = [
  { value: 0, label: "从不" },
  { value: 5, label: "5 分钟" },
  { value: 15, label: "15 分钟" },
  { value: 30, label: "30 分钟" },
  { value: 60, label: "1 小时" },
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
  );

  const currentField = (
    <TextField
      type="password"
      label="当前启动密码"
      value={current}
      autoFocus
      onChange={(e) => setCurrent(e.target.value)}
    />
  );

  const footer = (label: string, disabled: boolean, onConfirm: () => void, danger = false) => (
    <>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => begin(null)} disabled={working}>
          取消
        </Button>
        <Button variant={danger ? "danger" : "primary"} disabled={disabled || working} onClick={onConfirm}>
          {working ? "处理中…" : label}
        </Button>
      </div>
    </>
  );

  return (
    <div className="flex flex-col gap-7">
      <h2 className="text-lg font-semibold">安全</h2>

      {/* ─── Status card ─────────────────────────────────────────── */}
      <div
        className={cn(
          "flex items-start gap-3.5 rounded-2xl border p-4",
          has ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-app-border bg-app-subtle/40",
        )}
      >
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            has ? "bg-emerald-500/15 text-emerald-600" : "bg-app-subtle text-app-muted",
          )}
        >
          {has ? <ShieldCheck size={20} /> : <Lock size={20} />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-semibold">{has ? "已设置启动密码" : "未设置启动密码"}</span>
          <span className="text-xs leading-5 text-app-muted">
            {has
              ? "打开 Trove 需要先输入密码。数据文件拿到别的电脑上也打不开。"
              : "库文件始终是加密的，云同步、索引或直接用数据库工具都读不了。但任何能打开这台电脑的人都能打开 Trove。"}
          </span>
        </div>
      </div>

      {/* ─── Startup password ────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="text-sm font-medium">启动密码</div>

        {!has ? (
          action === "set" ? (
            <div className="flex flex-col gap-3 rounded-xl border border-app-accent/40 p-3.5">
              {pair}
              <span className="text-xs text-app-muted">设置后会给你一个恢复密钥，忘记密码时用它解锁。</span>
              {footer("设置", !pairOk, () =>
                run(async () => {
                  const code = await sec().setPassword(pw);
                  showRecovery({ code, target: "Trove" });
                }),
              )}
            </div>
          ) : (
            <Button variant="primary" icon={<Lock size={14} />} className="self-start" onClick={() => begin("set")}>
              设置启动密码
            </Button>
          )
        ) : (
          <div className="flex flex-col gap-2">
            <ActionRow
              icon={<KeyRound size={16} />}
              title="修改启动密码"
              desc="只换钥匙，不重写数据。"
              active={action === "change"}
              onClick={() => begin("change")}
            >
              {currentField}
              {pair}
              {footer("修改", !current || !pairOk, () =>
                run(async () => {
                  await sec().changePassword(current, pw);
                  toast.success("启动密码已修改");
                }),
              )}
            </ActionRow>
            <ActionRow
              icon={<LifeBuoy size={16} />}
              title={status.appRecovery ? "重新生成恢复密钥" : "生成恢复密钥"}
              desc={status.appRecovery ? "旧的恢复密钥会立即失效。" : "现在没有恢复密钥，忘记密码就打不开 Trove。"}
              active={action === "recovery"}
              onClick={() => begin("recovery")}
            >
              {currentField}
              {footer("生成", !current, () =>
                run(async () => {
                  const code = await sec().resetRecovery(current);
                  showRecovery({ code, target: "Trove" });
                }),
              )}
            </ActionRow>
            <ActionRow
              icon={<ShieldOff size={16} />}
              title="移除启动密码"
              desc="打开 Trove 不再需要密码。设了密码的库不受影响。"
              danger
              active={action === "remove"}
              onClick={() => begin("remove")}
            >
              {currentField}
              {footer(
                "移除",
                !current,
                () =>
                  run(async () => {
                    await sec().removePassword(current);
                    toast.success("已移除启动密码");
                  }),
                true,
              )}
            </ActionRow>
          </div>
        )}
      </section>

      {/* ─── Idle lock ───────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Timer size={14} />
          空闲自动锁定
        </div>
        <div className="text-xs leading-5 text-app-muted">
          {has
            ? "一段时间没有操作后锁定整个 Trove。"
            : "没有启动密码时，只会锁定用密码打开的加密库。"}
        </div>
        <div className="mt-1 inline-flex w-fit gap-1 rounded-xl bg-app-subtle p-1">
          {IDLE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => void save("idleLockMinutes", o.value).catch((e) => toast.error("保存失败", e))}
              className={cn(
                "h-8 rounded-lg px-3 text-xs font-medium transition",
                idle === o.value ? "bg-app-panel text-app-fg shadow-sm" : "text-app-fg/60 hover:text-app-fg",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>

      {/* ─── Leftovers from older versions ───────────────────────── */}
      <section className="flex flex-col gap-2 border-t border-app-border pt-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Eraser size={14} />
          清理旧版本留下的痕迹
        </div>

        {status.legacyProblem && (
          <Notice tone="warn" icon={<AlertTriangle size={14} />}>
            {status.legacyProblem}
          </Notice>
        )}

        <div className="flex items-center justify-between gap-3 rounded-xl border border-app-border p-3.5">
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">升级前的明文数据库</span>
            <span className="text-xs leading-5 text-app-muted">
              {status.legacyPlainCopy
                ? "升级时迁移到了加密库，原来的明文文件还留在数据目录里。确认数据都在之后可以删除。"
                : "没有残留。"}
            </span>
          </div>
          {status.legacyPlainCopy ? (
            <Button
              variant="secondary"
              className="text-red-500"
              onClick={() =>
                void ipc
                  .deleteLegacyCopy()
                  .then(() => sec().refresh())
                  .then(() => toast.success("已删除明文数据库"))
                  .catch((e) => toast.error("删除失败", e))
              }
            >
              删除
            </Button>
          ) : (
            <Check size={16} className="shrink-0 text-emerald-500" />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-app-border p-3.5">
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">界面缓存与浏览记录</span>
            <span className="text-xs leading-5 text-app-muted">
              旧版本的界面缓存里记录过媒体文件的路径。现在的版本不再写入，旧的会在下次启动时清空。
            </span>
          </div>
          <Button
            variant="secondary"
            disabled={purgeScheduled}
            onClick={() =>
              void ipc
                .scheduleWebviewPurge()
                .then(() => {
                  setPurgeScheduled(true);
                  toast.success("下次启动时清空");
                })
                .catch((e) => toast.error("操作失败", e))
            }
          >
            {purgeScheduled ? "已安排" : "下次启动时清空"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function ActionRow({
  icon,
  title,
  desc,
  active,
  danger,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  active: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border transition", active ? "border-app-accent/40" : "border-app-border")}>
      <button type="button" onClick={onClick} className="flex w-full items-start gap-3 p-3.5 text-left">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            danger ? "bg-red-500/10 text-red-500" : "bg-app-subtle text-app-fg/70",
          )}
        >
          {icon}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className={cn("text-sm font-medium", danger && "text-red-500")}>{title}</span>
          <span className="text-xs leading-5 text-app-muted">{desc}</span>
        </div>
      </button>
      {active && <div className="flex flex-col gap-3 px-3.5 pb-3.5">{children}</div>}
    </div>
  );
}
