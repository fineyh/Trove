import { useConversationsStore } from "../../../stores/conversations";
import { useMessagesStore } from "../../../stores/messages";
import { useConvMediaStore } from "../../../stores/convMedia";
import { useSessionStore } from "../../../stores/session";
import { useSettingsStore } from "../../../stores/settings";
import { useThemeStore } from "../../../stores/theme";
import { toast } from "../../../stores/toast";
import type { AppSettings } from "../../../types";
import { Segmented } from "../../ui/Segmented";
import { Switch } from "../../ui/Switch";
import { Group, Page, Row } from "../SettingsKit";

export function GeneralPane() {
  const settings = useSettingsStore((s) => s.settings);
  const save = useSettingsStore((s) => s.save);
  const theme = useThemeStore((s) => s.pref);
  const setTheme = useThemeStore((s) => s.set);

  const set = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    try {
      await save(key, value);
      if (key === "offlineContent") {
        // What is visible changed: refetch what is on screen.
        void useConversationsStore.getState().refresh();
        useConvMediaStore.getState().reset();
        const active = useSessionStore.getState().activeConversationId;
        if (active !== null) void useMessagesStore.getState().load(active);
      }
    } catch (e) {
      toast.error("无法保存设置", e);
    }
  };

  return (
    <Page title="通用">
      <Group title="外观">
        <Row label="主题">
          <Segmented
            value={theme}
            onChange={(v) => void setTheme(v).catch((e) => toast.error("无法保存设置", e))}
            options={[
              { value: "system", label: "跟随系统" },
              { value: "light", label: "浅色" },
              { value: "dark", label: "深色" },
            ]}
          />
        </Row>
      </Group>

      <Group title="内容">
        <Row label="显示离线文件" description="磁盘未连接时，仍显示缩略图">
          <Switch
            label="显示离线文件"
            checked={settings.offlineContent === "show"}
            onChange={(on) => void set("offlineContent", on ? "show" : "hide")}
          />
        </Row>
        <Row label="地图">
          <Switch
            label="地图"
            checked={settings.mapTiles === "online"}
            onChange={(on) => {
              if (!on) useSessionStore.getState().setMapOpen(false);
              void set("mapTiles", on ? "online" : "off");
            }}
          />
        </Row>
        <Row label="观看记录">
          <Switch
            label="观看记录"
            checked={settings.viewStats === "on"}
            onChange={(on) => void set("viewStats", on ? "on" : "off")}
          />
        </Row>
      </Group>
    </Page>
  );
}
