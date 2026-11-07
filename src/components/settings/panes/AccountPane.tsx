import { UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuthStore } from "../../../stores/auth";
import { errText } from "../../../lib/errors";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/Notice";
import { Group, Page, Row } from "../SettingsKit";

export function AccountPane() {
  const status = useAuthStore((s) => s.status);
  const ready = useAuthStore((s) => s.ready);
  const busy = useAuthStore((s) => s.busy);
  const refresh = useAuthStore((s) => s.refresh);
  const login = useAuthStore((s) => s.login);
  const doLogout = useAuthStore((s) => s.logout);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e: unknown) {
      setError(errText(e));
    }
  };

  const avatar = status.pictureUrl ? (
    <img src={status.pictureUrl} alt="" className="h-9 w-9 rounded-full" referrerPolicy="no-referrer" />
  ) : (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-app-subtle text-app-muted">
      <UserRound size={18} />
    </div>
  );

  return (
    <Page title="账号">
      <Group title="Google 账号" footer="只用于显示头像和邮箱，不上传任何内容。">
        {!ready ? (
          <Row label="正在读取…" leading={avatar} />
        ) : status.hasIdentity ? (
          <Row
            leading={avatar}
            label={status.displayName ?? status.email ?? "Google 用户"}
            description={status.displayName ? status.email : undefined}
          >
            <Button onClick={() => void run(doLogout)} loading={busy}>
              退出登录
            </Button>
          </Row>
        ) : (
          <Row leading={avatar} label="未登录">
            <Button variant="primary" onClick={() => void run(login)} loading={busy}>
              {busy ? "等待浏览器授权" : "使用 Google 登录"}
            </Button>
          </Row>
        )}
      </Group>
      {error && <Notice tone="danger">{error}</Notice>}
    </Page>
  );
}
