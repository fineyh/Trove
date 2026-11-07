import {
  FileKey2,
  FolderOpen,
  KeyRound,
  LifeBuoy,
  Lock,
  LockOpen,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import * as ipc from "../../ipc/client";
import { cn } from "../../lib/cn";
import { errText } from "../../lib/errors";
import {
  DEFAULT_LIBRARY_COLOR,
  LIBRARY_COLORS,
  useLibrariesStore,
} from "../../stores/libraries";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import type { LibraryInfo } from "../../types";
import { Button, Modal, Notice, Switch, TextField } from "../ui/Modal";
import { LibraryAvatar } from "./LibraryAvatar";
import { UnlockForm } from "./UnlockForm";

const EMOJIS = ["", "📁", "🏠", "✈️", "📷", "🎬", "🎵", "💼", "❤️", "🌿", "⭐", "🌙", "🐱", "🔒"];

export const MIN_PASSWORD = 6;

// ─── Shared bits ────────────────────────────────────────────────────────────

function AppearanceFields({
  name,
  setName,
  icon,
  setIcon,
  color,
  setColor,
  autoFocus,
}: {
  name: string;
  setName: (v: string) => void;
  icon: string;
  setIcon: (v: string) => void;
  color: string;
  setColor: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3">
        <LibraryAvatar name={name || "库"} icon={icon || null} color={color} size={52} />
        <div className="flex-1">
          <TextField
            label="名称"
            value={name}
            maxLength={40}
            autoFocus={autoFocus}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：旅行、私密、工作"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-app-fg/70">颜色</span>
        <div className="flex flex-wrap gap-2">
          {Object.entries(LIBRARY_COLORS).map(([key, c]) => (
            <button
              key={key}
              type="button"
              onClick={() => setColor(key)}
              aria-label={key}
              className={cn(
                "h-7 w-7 rounded-full transition",
                color === key
                  ? "ring-2 ring-app-fg/70 ring-offset-2 ring-offset-app-panel"
                  : "hover:scale-110",
              )}
              style={{ background: c.bg }}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-app-fg/70">图标</span>
        <div className="grid grid-cols-7 gap-1.5">
          {EMOJIS.map((e) => (
            <button
              key={e || "letter"}
              type="button"
              onClick={() => setIcon(e)}
              className={cn(
                "flex h-9 items-center justify-center rounded-lg border text-lg transition",
                icon === e
                  ? "border-app-accent bg-app-accent/10"
                  : "border-transparent bg-app-subtle/60 hover:bg-app-subtle",
              )}
            >
              {e || <span className="text-xs font-semibold text-app-muted">首字</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function usePasswordPair() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const tooShort = pw.length > 0 && pw.length < MIN_PASSWORD;
  const mismatch = pw2.length > 0 && pw !== pw2;
  const ok = pw.length >= MIN_PASSWORD && pw === pw2;
  const reset = () => {
    setPw("");
    setPw2("");
  };
  return { pw, setPw, pw2, setPw2, tooShort, mismatch, ok, reset };
}

function PasswordPair({
  pair,
  labels = ["密码", "再输入一次"],
}: {
  pair: ReturnType<typeof usePasswordPair>;
  labels?: [string, string];
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <TextField
        type="password"
        label={labels[0]}
        value={pair.pw}
        onChange={(e) => pair.setPw(e.target.value)}
        error={pair.tooShort ? `至少 ${MIN_PASSWORD} 个字符` : undefined}
      />
      <TextField
        type="password"
        label={labels[1]}
        value={pair.pw2}
        onChange={(e) => pair.setPw2(e.target.value)}
        error={pair.mismatch ? "两次输入不一致" : undefined}
      />
    </div>
  );
}

// ─── Create ─────────────────────────────────────────────────────────────────

export function CreateLibraryDialog() {
  const dialog = useSessionStore((s) => s.libraryDialog);
  const setDialog = useSessionStore((s) => s.setLibraryDialog);
  const showRecovery = useSessionStore((s) => s.showRecovery);
  const open = dialog?.mode === "create";

  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [color, setColor] = useState(DEFAULT_LIBRARY_COLOR);
  const [encrypt, setEncrypt] = useState(false);
  const pair = usePasswordPair();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setIcon("");
    const keys = Object.keys(LIBRARY_COLORS);
    setColor(keys[Math.floor(Math.random() * keys.length)]);
    setEncrypt(false);
    pair.reset();
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canSubmit = !busy && name.trim().length > 0 && (!encrypt || pair.ok);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const created = await ipc.createLibrary({
        name: name.trim(),
        icon: icon || null,
        color,
        password: encrypt ? pair.pw : null,
      });
      await useLibrariesStore.getState().refresh();
      useLibrariesStore.getState().select(created.id);
      setDialog(null);
      if (created.recoveryCode) {
        showRecovery({ code: created.recoveryCode, target: name.trim() });
      } else {
        toast.success(`已创建「${name.trim()}」`);
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      busy={busy}
      onClose={() => setDialog(null)}
      title="新建库"
      subtitle="每个库是一个独立的加密文件，有自己的会话、缩略图和搜索。"
      footer={
        <>
          <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {busy ? "创建中…" : "创建"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <AppearanceFields
          name={name}
          setName={setName}
          icon={icon}
          setIcon={setIcon}
          color={color}
          setColor={setColor}
          autoFocus
        />

        <div
          className={cn(
            "flex flex-col gap-3 rounded-xl border p-3.5 transition",
            encrypt ? "border-app-accent/40 bg-app-accent/[0.04]" : "border-app-border",
          )}
        >
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-app-accent/10 text-app-accent">
              <Lock size={15} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">设置密码</span>
              <span className="text-xs leading-5 text-app-muted">
                设了密码的库不随应用打开。锁着时，它的会话、缩略图、地图位置都不会出现。
              </span>
            </div>
            <Switch checked={encrypt} onChange={setEncrypt} label="设置密码" />
          </div>
          {encrypt && (
            <>
              <PasswordPair pair={pair} />
              <span className="text-xs text-app-muted">
                创建后会给你一个恢复密钥，忘记密码时用它解锁。
              </span>
            </>
          )}
        </div>

        {error && <Notice tone="danger">{error}</Notice>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ─── Settings ───────────────────────────────────────────────────────────────

type Tab = "general" | "security";

export function LibrarySettingsDialog() {
  const dialog = useSessionStore((s) => s.libraryDialog);
  const setDialog = useSessionStore((s) => s.setLibraryDialog);
  const libraries = useLibrariesStore((s) => s.list);
  const id = dialog?.mode === "settings" ? dialog.id : null;
  const lib = useMemo(() => libraries.find((l) => l.id === id) ?? null, [libraries, id]);
  const [tab, setTab] = useState<Tab>("general");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (id) setTab("general");
  }, [id]);

  // Re-keyed (password added) or deleted underneath us: close.
  useEffect(() => {
    if (id && !lib && useLibrariesStore.getState().ready) setDialog(null);
  }, [id, lib, setDialog]);

  if (!lib) return null;

  return (
    <Modal
      open
      busy={busy}
      onClose={() => setDialog(null)}
      width="md"
      icon={<LibraryAvatar name={lib.name} icon={lib.icon} color={lib.color} size={40} />}
      title={lib.name}
      subtitle={
        lib.isMain
          ? "主库 · 随应用打开"
          : lib.encrypted
            ? lib.unlocked
              ? "加密库 · 已解锁"
              : "加密库 · 已锁定"
            : "普通库 · 随应用打开"
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-app-subtle p-1 text-sm">
          {(
            [
              ["general", "常规"],
              ["security", "密码与解锁"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                "h-8 rounded-lg font-medium transition",
                tab === k ? "bg-app-panel text-app-fg shadow-sm" : "text-app-fg/60 hover:text-app-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "general" ? (
          <GeneralTab lib={lib} setBusy={setBusy} />
        ) : !lib.unlocked ? (
          <div className="flex flex-col gap-3">
            <Notice icon={<Lock size={14} />}>先解锁这个库，才能修改它的密码和解锁方式。</Notice>
            <UnlockForm
              allowRecovery={lib.hasRecovery}
              onUnlock={(s, m) => useLibrariesStore.getState().unlock(lib.id, s, m)}
            />
          </div>
        ) : (
          <SecurityTab lib={lib} setBusy={setBusy} />
        )}
      </div>
    </Modal>
  );
}

function GeneralTab({ lib, setBusy }: { lib: LibraryInfo; setBusy: (b: boolean) => void }) {
  const setDialog = useSessionStore((s) => s.setLibraryDialog);
  const [name, setName] = useState(lib.name);
  const [icon, setIcon] = useState(lib.icon ?? "");
  const [color, setColor] = useState(lib.color ?? DEFAULT_LIBRARY_COLOR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const dirty =
    name.trim() !== lib.name || (icon || null) !== lib.icon || color !== (lib.color ?? DEFAULT_LIBRARY_COLOR);

  const save = async () => {
    if (!dirty || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await ipc.updateLibrary({ id: lib.id, name: name.trim(), icon, color });
      await useLibrariesStore.getState().refresh();
      toast.success("已保存");
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setBusy(true);
    setError(null);
    try {
      await ipc.deleteLibrary(lib.id, confirmName);
      await useLibrariesStore.getState().refresh();
      setDialog(null);
      toast.success(`已删除「${lib.name}」`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setDeleting(false);
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <AppearanceFields
        name={name}
        setName={setName}
        icon={icon}
        setIcon={setIcon}
        color={color}
        setColor={setColor}
      />
      <div className="flex justify-end">
        <Button variant="primary" onClick={save} disabled={!dirty || saving || !name.trim()}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      {!lib.isMain && (
        <div className="flex flex-col gap-3 border-t border-app-border pt-4">
          {!showDelete ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium">删除库</span>
                <span className="text-xs text-app-muted">会话和缩略图一起删除，磁盘上的原文件不受影响。</span>
              </div>
              <Button
                variant="secondary"
                className="text-red-500"
                icon={<Trash2 size={14} />}
                disabled={!lib.unlocked}
                title={lib.unlocked ? undefined : "先解锁才能删除"}
                onClick={() => setShowDelete(true)}
              >
                删除…
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-3.5">
              <span className="text-sm">
                输入库名 <b className="select-text">{lib.name}</b> 确认删除。此操作无法撤销。
              </span>
              <TextField
                value={confirmName}
                autoFocus
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={lib.name}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowDelete(false)} disabled={deleting}>
                  取消
                </Button>
                <Button
                  variant="danger"
                  disabled={deleting || confirmName.trim() !== lib.name.trim()}
                  onClick={remove}
                >
                  {deleting ? "删除中…" : "永久删除"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type SecAction = null | "set" | "change" | "remove" | "recovery";

function SecurityTab({ lib, setBusy }: { lib: LibraryInfo; setBusy: (b: boolean) => void }) {
  const showRecovery = useSessionStore((s) => s.showRecovery);
  const [action, setAction] = useState<SecAction>(null);
  const pair = usePasswordPair();
  const [current, setCurrent] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = (a: SecAction) => {
    setAction(a);
    pair.reset();
    setCurrent("");
    setError(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setWorking(true);
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAction(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setWorking(false);
      setBusy(false);
    }
  };

  if (lib.isMain) {
    return (
      <Notice icon={<ShieldCheck size={14} />}>
        主库跟随应用一起打开。想保护主库，请在「设置 → 安全」里设置启动密码：设了之后，打开 Trove 就要先输入密码。
      </Notice>
    );
  }

  if (!lib.encrypted) {
    return (
      <div className="flex flex-col gap-4">
        <Notice icon={<LockOpen size={14} />}>
          这个库现在随应用一起打开。设置密码后它会单独上锁，锁着时其中的内容在 Trove 里完全不可见。
        </Notice>
        {action === "set" ? (
          <div className="flex flex-col gap-3">
            <PasswordPair pair={pair} />
            <span className="text-xs text-app-muted">
              库会被重新加密成一个新文件，内容越多耗时越长。完成后给你一个恢复密钥。
            </span>
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => begin(null)} disabled={working}>
                取消
              </Button>
              <Button
                variant="primary"
                disabled={!pair.ok || working}
                onClick={() =>
                  run(async () => {
                    const res = await ipc.setLibraryPassword(lib.id, pair.pw);
                    const wasCurrent = useLibrariesStore.getState().current === lib.id;
                    await useLibrariesStore.getState().refresh();
                    if (wasCurrent) useLibrariesStore.getState().select(res.id);
                    useSessionStore.getState().setLibraryDialog({ mode: "settings", id: res.id });
                    if (res.recoveryCode) showRecovery({ code: res.recoveryCode, target: lib.name });
                  })
                }
              >
                {working ? "正在加密…" : "设置密码"}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="primary" icon={<Lock size={14} />} className="self-start" onClick={() => begin("set")}>
            设置密码
          </Button>
        )}
      </div>
    );
  }

  const pickKeyfileDir = async () => {
    const dir = await openDialog({ directory: true, multiple: false, title: "选择放钥匙文件的文件夹" });
    if (typeof dir !== "string") return;
    await run(async () => {
      const path = await ipc.setLibraryKeyfile(lib.id, dir);
      await useLibrariesStore.getState().refresh();
      toast.success("已创建钥匙文件", path);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Row
        icon={<KeyRound size={16} />}
        title="修改密码"
        desc="只换钥匙，不重写数据，瞬间完成。"
        active={action === "change"}
        onClick={() => begin(action === "change" ? null : "change")}
      >
        <TextField type="password" label="当前密码" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <PasswordPair pair={pair} labels={["新密码", "再输入一次"]} />
        <Actions
          working={working}
          error={error}
          disabled={!current || !pair.ok}
          label="修改"
          onCancel={() => begin(null)}
          onConfirm={() =>
            run(async () => {
              await ipc.changeLibraryPassword(lib.id, current, pair.pw);
              toast.success("密码已修改");
            })
          }
        />
      </Row>

      <Row
        icon={<LifeBuoy size={16} />}
        title={lib.hasRecovery ? "重新生成恢复密钥" : "生成恢复密钥"}
        desc={lib.hasRecovery ? "旧的恢复密钥会立即失效。" : "现在没有恢复密钥，忘记密码就无法打开。"}
        active={action === "recovery"}
        onClick={() => begin(action === "recovery" ? null : "recovery")}
      >
        <TextField type="password" label="当前密码" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <Actions
          working={working}
          error={error}
          disabled={!current}
          label="生成"
          onCancel={() => begin(null)}
          onConfirm={() =>
            run(async () => {
              const code = await ipc.resetLibraryRecovery(lib.id, current);
              await useLibrariesStore.getState().refresh();
              showRecovery({ code, target: lib.name });
            })
          }
        />
      </Row>

      <div className="flex items-start gap-3 rounded-xl border border-app-border p-3.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-app-subtle text-app-fg/70">
          <FileKey2 size={16} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-medium">钥匙文件</span>
          {lib.keyfilePath ? (
            <>
              <span className="select-text break-all font-mono text-[11px] text-app-muted">{lib.keyfilePath}</span>
              <span className="text-xs leading-5 text-app-muted">
                这个文件出现时库自动解锁，消失时自动上锁。把它放进 Cryptomator 之类的加密盘，盘开库开、盘关库锁。
              </span>
            </>
          ) : (
            <span className="text-xs leading-5 text-app-muted">
              在你选的文件夹里放一个钥匙文件：文件在，库就自动解锁；文件不在（比如加密盘关了），库就自动上锁。密码仍然可用。
            </span>
          )}
          <div className="mt-1.5 flex gap-2">
            <Button size="sm" icon={<FolderOpen size={13} />} onClick={pickKeyfileDir} disabled={working}>
              {lib.keyfilePath ? "换一个位置" : "选择文件夹…"}
            </Button>
            {lib.keyfilePath && (
              <Button
                size="sm"
                variant="ghost"
                disabled={working}
                onClick={() =>
                  run(async () => {
                    await ipc.removeLibraryKeyfile(lib.id);
                    await useLibrariesStore.getState().refresh();
                    toast.info("已停用钥匙文件", "文件本身没有删除，可以手动删掉。");
                  })
                }
              >
                停用
              </Button>
            )}
          </div>
        </div>
      </div>

      <Row
        icon={<ShieldOff size={16} />}
        title="移除密码"
        desc="库变回普通库，随应用一起打开。"
        danger
        active={action === "remove"}
        onClick={() => begin(action === "remove" ? null : "remove")}
      >
        <TextField type="password" label="当前密码" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <Actions
          working={working}
          error={error}
          disabled={!current}
          label="移除密码"
          danger
          onCancel={() => begin(null)}
          onConfirm={() =>
            run(async () => {
              await ipc.removeLibraryPassword(lib.id, current);
              await useLibrariesStore.getState().refresh();
              toast.success("已移除密码");
            })
          }
        />
      </Row>

      {error && action === null && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}

function Row({
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

function Actions({
  working,
  error,
  disabled,
  label,
  danger,
  onCancel,
  onConfirm,
}: {
  working: boolean;
  error: string | null;
  disabled: boolean;
  label: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={working}>
          取消
        </Button>
        <Button variant={danger ? "danger" : "primary"} disabled={disabled || working} onClick={onConfirm}>
          {working ? "处理中…" : label}
        </Button>
      </div>
    </>
  );
}
