import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import * as ipc from "../../ipc/client";
import { cn } from "../../lib/cn";
import { errText } from "../../lib/errors";
import { DEFAULT_LIBRARY_COLOR, LIBRARY_COLORS, useLibrariesStore } from "../../stores/libraries";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import type { LibraryInfo } from "../../types";
import { Group, Row } from "../settings/SettingsKit";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { Notice } from "../ui/Notice";
import { Segmented } from "../ui/Segmented";
import { Switch } from "../ui/Switch";
import { LibraryAvatar } from "./LibraryAvatar";
import { LIBRARY_ICONS, iconValue } from "./libraryIcons";
import { UnlockForm } from "./UnlockForm";

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
  const swatch = (selected: boolean) =>
    cn(
      "flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-fast",
      selected ? "bg-app-accent/10 text-app-accent ring-1 ring-inset ring-app-accent/40" : "text-app-secondary hover:bg-app-hover/5 hover:text-app-fg",
    );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3">
        <LibraryAvatar name={name || "库"} icon={icon || null} color={color} size={48} />
        <div className="flex-1">
          <TextField label="名称" value={name} maxLength={40} autoFocus={autoFocus} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-app-secondary">颜色</span>
        <div className="flex flex-wrap gap-2">
          {Object.entries(LIBRARY_COLORS).map(([key, c]) => (
            <button
              key={key}
              type="button"
              onClick={() => setColor(key)}
              aria-label={key}
              aria-pressed={color === key}
              className="flex h-6 w-6 items-center justify-center rounded-full text-white transition-transform duration-fast hover:scale-110"
              style={{ background: c.bg }}
            >
              {color === key && <Check size={14} strokeWidth={3} />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-app-secondary">图标</span>
        <div className="grid grid-cols-[repeat(9,2rem)] justify-between gap-y-1">
          <button type="button" onClick={() => setIcon("")} aria-label="首字母" className={swatch(icon === "")}>
            <span className="text-sm font-semibold">{Array.from(name.trim())[0]?.toUpperCase() ?? "A"}</span>
          </button>
          {Object.entries(LIBRARY_ICONS).map(([key, Glyph]) => (
            <button key={key} type="button" onClick={() => setIcon(iconValue(key))} aria-label={key} className={swatch(icon === iconValue(key))}>
              <Glyph size={17} />
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

function PasswordPair({ pair, labels = ["密码", "确认密码"] }: { pair: ReturnType<typeof usePasswordPair>; labels?: [string, string] }) {
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

/** Inline form under a row: fields, error, cancel / confirm. */
function InlineForm({
  children,
  error,
  working,
  ready,
  label,
  danger,
  onCancel,
  onConfirm,
}: {
  children: React.ReactNode;
  error: string | null;
  working: boolean;
  ready: boolean;
  label: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !working) onConfirm();
      }}
    >
      {children}
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} disabled={working}>
          取消
        </Button>
        <Button type="submit" variant={danger ? "danger" : "primary"} disabled={!ready} loading={working}>
          {label}
        </Button>
      </div>
    </form>
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
      const created = await ipc.createLibrary({ name: name.trim(), icon: icon || null, color, password: encrypt ? pair.pw : null });
      await useLibrariesStore.getState().refresh();
      useLibrariesStore.getState().select(created.id);
      setDialog(null);
      if (created.recoveryCode) showRecovery({ code: created.recoveryCode, target: name.trim() });
      else toast.success(`已创建「${name.trim()}」`);
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
      footer={
        <>
          <Button onClick={() => setDialog(null)} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit} loading={busy}>
            创建
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
        <AppearanceFields name={name} setName={setName} icon={icon} setIcon={setIcon} color={color} setColor={setColor} autoFocus />

        <Group>
          <Row
            label="密码保护"
            description="锁定时，库里的内容不会出现在 Trove 中"
            expanded={encrypt ? <PasswordPair pair={pair} /> : undefined}
          >
            <Switch checked={encrypt} onChange={setEncrypt} label="密码保护" />
          </Row>
        </Group>

        {error && <Notice tone="danger">{error}</Notice>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ─── Settings ───────────────────────────────────────────────────────────────

type Tab = "general" | "security";

function librarySubtitle(lib: LibraryInfo): string {
  if (!lib.encrypted) return "随 Trove 解锁";
  return lib.unlocked ? "密码保护 · 已解锁" : "密码保护 · 已锁定";
}

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
      icon={<LibraryAvatar name={lib.name} icon={lib.icon} color={lib.color} size={36} />}
      title={lib.name}
      subtitle={librarySubtitle(lib)}
    >
      <div className="flex flex-col gap-5">
        <Segmented
          size="md"
          className="w-full"
          value={tab}
          onChange={setTab}
          options={[
            { value: "general", label: "外观" },
            { value: "security", label: "密码" },
          ]}
        />

        {tab === "general" ? (
          <GeneralTab lib={lib} setBusy={setBusy} />
        ) : !lib.unlocked ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-app-secondary">解锁后才能更改密码。</p>
            <UnlockForm allowRecovery={lib.hasRecovery} onUnlock={(s, m) => useLibrariesStore.getState().unlock(lib.id, s, m)} />
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

  const dirty = name.trim() !== lib.name || (icon || null) !== lib.icon || color !== (lib.color ?? DEFAULT_LIBRARY_COLOR);

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
      <AppearanceFields name={name} setName={setName} icon={icon} setIcon={setIcon} color={color} setColor={setColor} />
      <div className="flex justify-end">
        <Button variant="primary" onClick={save} disabled={!dirty || !name.trim()} loading={saving}>
          保存
        </Button>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      {!lib.isMain && (
        <Group>
          <Row
            label="删除库"
            description={lib.unlocked ? "会话和缩略图一并删除，磁盘上的文件不受影响" : "解锁后才能删除"}
            expanded={
              showDelete ? (
                <InlineForm
                  error={null}
                  working={deleting}
                  ready={confirmName.trim() === lib.name.trim()}
                  label="永久删除"
                  danger
                  onCancel={() => setShowDelete(false)}
                  onConfirm={() => void remove()}
                >
                  <TextField
                    label={`输入「${lib.name}」以确认`}
                    value={confirmName}
                    autoFocus
                    onChange={(e) => setConfirmName(e.target.value)}
                  />
                </InlineForm>
              ) : undefined
            }
          >
            {!showDelete && (
              <Button size="sm" variant="danger-secondary" disabled={!lib.unlocked} onClick={() => setShowDelete(true)}>
                删除…
              </Button>
            )}
          </Row>
        </Group>
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
    setAction((prev) => (prev === a ? null : a));
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

  const currentField = (
    <TextField type="password" label="当前密码" value={current} autoFocus onChange={(e) => setCurrent(e.target.value)} />
  );

  if (lib.isMain) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-app-secondary">这个库随 Trove 解锁。要保护它，请开启应用锁。</p>
        <Button
          size="sm"
          onClick={() => {
            useSessionStore.getState().setLibraryDialog(null);
            useSessionStore.getState().setSettingsOpen(true, "security");
          }}
        >
          打开隐私与安全
        </Button>
      </div>
    );
  }

  if (!lib.encrypted) {
    return (
      <Group>
        <Row
          label="密码保护"
          description="锁定时，库里的内容不会出现在 Trove 中"
          expanded={
            action === "set" ? (
              <InlineForm
                error={error}
                working={working}
                ready={pair.ok}
                label={working ? "正在加密" : "开启"}
                onCancel={() => begin(null)}
                onConfirm={() =>
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
                <PasswordPair pair={pair} />
              </InlineForm>
            ) : undefined
          }
        >
          <Switch checked={action === "set"} onChange={() => begin("set")} label="密码保护" />
        </Row>
      </Group>
    );
  }

  const pickKeyfileDir = async () => {
    const dir = await openDialog({ directory: true, multiple: false, title: "选择密钥文件的位置" });
    if (typeof dir !== "string") return;
    await run(async () => {
      await ipc.setLibraryKeyfile(lib.id, dir);
      await useLibrariesStore.getState().refresh();
      toast.success("已创建密钥文件");
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Group>
        <Row
          label="密码保护"
          expanded={
            action === "remove" ? (
              <InlineForm
                error={error}
                working={working}
                ready={current.length > 0}
                label="关闭密码保护"
                danger
                onCancel={() => begin(null)}
                onConfirm={() =>
                  run(async () => {
                    await ipc.removeLibraryPassword(lib.id, current);
                    await useLibrariesStore.getState().refresh();
                    toast.success("已关闭密码保护");
                  })
                }
              >
                {currentField}
              </InlineForm>
            ) : undefined
          }
        >
          <Switch checked={action !== "remove"} onChange={() => begin("remove")} label="密码保护" />
        </Row>
        <Row
          label="密码"
          expanded={
            action === "change" ? (
              <InlineForm
                error={error}
                working={working}
                ready={current.length > 0 && pair.ok}
                label="更改"
                onCancel={() => begin(null)}
                onConfirm={() =>
                  run(async () => {
                    await ipc.changeLibraryPassword(lib.id, current, pair.pw);
                    toast.success("密码已更改");
                  })
                }
              >
                {currentField}
                <PasswordPair pair={pair} labels={["新密码", "确认新密码"]} />
              </InlineForm>
            ) : undefined
          }
        >
          <Button size="sm" onClick={() => begin("change")}>
            更改
          </Button>
        </Row>
        <Row
          label="恢复密钥"
          description={lib.hasRecovery ? "忘记密码时用它解锁" : "未生成，忘记密码将无法打开"}
          expanded={
            action === "recovery" ? (
              <InlineForm
                error={error}
                working={working}
                ready={current.length > 0}
                label={lib.hasRecovery ? "重新生成" : "生成"}
                onCancel={() => begin(null)}
                onConfirm={() =>
                  run(async () => {
                    const code = await ipc.resetLibraryRecovery(lib.id, current);
                    await useLibrariesStore.getState().refresh();
                    showRecovery({ code, target: lib.name });
                  })
                }
              >
                {currentField}
              </InlineForm>
            ) : undefined
          }
        >
          <Button size="sm" onClick={() => begin("recovery")}>
            {lib.hasRecovery ? "重新生成" : "生成"}
          </Button>
        </Row>
      </Group>

      <Group
        title="密钥文件"
        footer={lib.keyfilePath ? undefined : "放在 U 盘或加密盘里：连上时自动解锁，断开时自动锁定。"}
      >
        <Row
          label={lib.keyfilePath ? <span className="selectable block truncate font-mono text-xs">{lib.keyfilePath}</span> : "未设置"}
          description={lib.keyfilePath ? "文件出现时自动解锁，消失时自动锁定" : undefined}
        >
          {lib.keyfilePath && (
            <Button
              size="sm"
              variant="ghost"
              disabled={working}
              onClick={() =>
                run(async () => {
                  await ipc.removeLibraryKeyfile(lib.id);
                  await useLibrariesStore.getState().refresh();
                  toast.info("已停用密钥文件", "文件本身仍在原处");
                })
              }
            >
              停用
            </Button>
          )}
          <Button size="sm" onClick={pickKeyfileDir} disabled={working}>
            {lib.keyfilePath ? "更换位置…" : "选择位置…"}
          </Button>
        </Row>
      </Group>

      {error && action === null && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}
