import { useEffect, useState } from "react";
import * as ipc from "../../../ipc/client";
import { isTauri } from "../../../hooks/useIsTauri";
import { formatDayDivider, formatMessageTime } from "../../../lib/datetime";
import { formatBytes } from "../../../lib/media";
import { toast } from "../../../stores/toast";
import { useUpdateStore } from "../../../stores/update";
import type { AppEnvironment } from "../../../types";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/Notice";
import { Segmented } from "../../ui/Segmented";
import { Switch } from "../../ui/Switch";
import { Group, Page, Row } from "../SettingsKit";
import appIcon from "../../../../src-tauri/icons/128x128@2x.png";

const REPO = "https://github.com/fineyh/Trove";

function when(ts: number): string {
  return `${formatDayDivider(ts)} ${formatMessageTime(ts)}`;
}

function envLine(env: AppEnvironment): string {
  const parts = [
    `Trove ${env.version}${env.channel === "beta" ? "（预览版通道）" : ""}`,
    env.os,
    env.arch,
  ];
  if (env.webview) parts.push(`WebView ${env.webview}`);
  return parts.join(" · ");
}

/** Only version and system go into the report; nothing from the libraries. */
function issueUrl(env: AppEnvironment | null): string {
  const body = [
    "**发生了什么**",
    "",
    "",
    "**怎样能重现**",
    "1. ",
    "",
    "**期望的结果**",
    "",
    "",
    "---",
    env ? envLine(env) : "",
  ].join("\n");
  return `${REPO}/issues/new?body=${encodeURIComponent(body)}`;
}

/**
 * The notes are a CHANGELOG section: `### 新增` headings and `- ` bullets.
 * Render just those two; anything else is a plain line.
 */
function ReleaseNotes({ text }: { text: string }) {
  const plain = (s: string) => s.replace(/\*\*|`/g, "");
  return (
    <div className="selectable flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-lg bg-app-subtle px-3 py-2 text-xs leading-relaxed text-app-secondary">
      {text.split(/\r?\n/).map((line, i) => {
        const t = line.trim();
        if (!t) return null;
        const h = /^#{1,6}\s+(.*)$/.exec(t);
        if (h) return <p key={i} className="mt-1 font-medium text-app-fg first:mt-0">{plain(h[1])}</p>;
        const li = /^[-*]\s+(.*)$/.exec(t);
        if (li)
          return (
            <p key={i} className="flex gap-1.5">
              <span aria-hidden>·</span>
              <span>{plain(li[1])}</span>
            </p>
          );
        return <p key={i}>{plain(t)}</p>;
      })}
    </div>
  );
}

export function AboutPane() {
  const [env, setEnv] = useState<AppEnvironment | null>(null);
  const info = useUpdateStore((s) => s.info);
  const phase = useUpdateStore((s) => s.phase);
  const error = useUpdateStore((s) => s.error);
  const channel = useUpdateStore((s) => s.channel);
  const auto = useUpdateStore((s) => s.auto);
  const lastCheck = useUpdateStore((s) => s.lastCheck);
  const check = useUpdateStore((s) => s.check);
  const install = useUpdateStore((s) => s.install);
  const setChannel = useUpdateStore((s) => s.setChannel);
  const setAuto = useUpdateStore((s) => s.setAuto);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void ipc
      .appEnvironment()
      .then((e) => {
        if (!cancelled) setEnv(e);
      })
      .catch((e) => console.error("app_environment failed", e));
    return () => {
      cancelled = true;
    };
  }, []);

  // Freshly checked result for the current channel.
  const available = info?.available && info.channel === channel ? info : null;
  const busy = phase.kind === "downloading" || phase.kind === "installing";

  let status: string | undefined;
  if (phase.kind === "checking") status = "正在检查…";
  else if (phase.kind === "downloading")
    status =
      phase.total !== null
        ? `正在下载 ${formatBytes(phase.downloaded)} / ${formatBytes(phase.total)}`
        : `正在下载 ${formatBytes(phase.downloaded)}`;
  else if (phase.kind === "installing") status = "正在安装，随后自动重启";
  else if (available) status = available.date ? `发布于 ${available.date}` : undefined;
  else if (info && info.channel === channel) status = `已是最新版本 · ${when(info.checkedAt)}检查`;
  else if (lastCheck) status = `上次检查：${when(lastCheck)}`;

  const pct =
    phase.kind === "downloading" && phase.total ? Math.min(100, (phase.downloaded / phase.total) * 100) : null;

  const copyEnv = async () => {
    if (!env) return;
    try {
      await navigator.clipboard.writeText(envLine(env));
      toast.success("已复制");
    } catch (e) {
      toast.error("复制失败", e);
    }
  };

  const open = (url: string) => void ipc.openUrl(url).catch((e) => toast.error("打不开浏览器", e));

  return (
    <Page title="关于">
      <div className="flex items-center gap-4 px-1">
        <img src={appIcon} alt="" className="h-14 w-14" draggable={false} />
        <div className="flex flex-col">
          <span className="text-base font-semibold">Trove</span>
          <span className="text-xs text-app-muted">版本 {env?.version ?? "—"}</span>
        </div>
      </div>

      <Group title="更新">
        <Row
          label={available ? `新版本 ${available.latestVersion}` : "软件更新"}
          description={status}
          expanded={
            phase.kind === "downloading" || available?.notes ? (
              <>
                {phase.kind === "downloading" && (
                  <div className="h-1 overflow-hidden rounded-full bg-app-subtle">
                    <div
                      className={
                        pct === null
                          ? "h-full w-1/3 animate-pulse rounded-full bg-app-accent"
                          : "h-full rounded-full bg-app-accent transition-[width] duration-fast"
                      }
                      style={pct === null ? undefined : { width: `${pct}%` }}
                    />
                  </div>
                )}
                {available?.notes && <ReleaseNotes text={available.notes} />}
              </>
            ) : undefined
          }
        >
          {available ? (
            <Button variant="primary" size="sm" onClick={() => void install()} loading={busy}>
              {busy ? "正在更新" : "下载并安装"}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void check()} loading={phase.kind === "checking"}>
              检查更新
            </Button>
          )}
        </Row>
        <Row label="自动检查更新">
          <Switch
            label="自动检查更新"
            checked={auto}
            onChange={(on) => void setAuto(on).catch((e) => toast.error("设置没有保存", e))}
          />
        </Row>
        <Row label="更新通道">
          <Segmented
            value={channel}
            onChange={(v) => {
              if (busy || v === channel) return;
              void setChannel(v).catch((e) => toast.error("设置没有保存", e));
            }}
            options={[
              { value: "stable", label: "正式版" },
              { value: "beta", label: "预览版" },
            ]}
          />
        </Row>
      </Group>

      {error && <Notice tone="danger">{error}</Notice>}

      <Group title="帮助">
        <Row label="更新日志" onClick={() => open(`${REPO}/releases`)} />
        <Row label="反馈问题" onClick={() => open(issueUrl(env))} />
        <Row label="版本信息" description={env ? envLine(env) : "—"}>
          <Button size="sm" onClick={() => void copyEnv()} disabled={!env}>
            复制
          </Button>
        </Row>
      </Group>
    </Page>
  );
}
