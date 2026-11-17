import { useState } from "react";
import * as ipc from "../../../ipc/client";
import { useConversationsStore } from "../../../stores/conversations";
import { useCurrentLibrary } from "../../../stores/libraries";
import { useMessagesStore } from "../../../stores/messages";
import { useConvMediaStore } from "../../../stores/convMedia";
import { useSessionStore } from "../../../stores/session";
import { useSettingsStore } from "../../../stores/settings";
import { useThemeStore } from "../../../stores/theme";
import { toast } from "../../../stores/toast";
import type { AppSettings } from "../../../types";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Segmented } from "../../ui/Segmented";
import { Switch } from "../../ui/Switch";
import { Group, Page, Row } from "../SettingsKit";

export function GeneralPane() {
  const settings = useSettingsStore((s) => s.settings);
  const save = useSettingsStore((s) => s.save);
  const theme = useThemeStore((s) => s.pref);
  const setTheme = useThemeStore((s) => s.set);
  const lib = useCurrentLibrary();
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const clearStats = async () => {
    if (!lib) return;
    setClearing(true);
    try {
      await ipc.statsClear(lib.id);
      // Play counts went back to zero; show that.
      const active = useSessionStore.getState().activeConversationId;
      if (active !== null) void useMessagesStore.getState().refresh(active);
      setConfirmClear(false);
    } catch (e) {
      toast.error("没有清除", e);
    } finally {
      setClearing(false);
    }
  };

  const set = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    try {
      await save(key, value);
      if (key === "offlineContent") {
        // What's visible changed: refetch what's on screen.
        void useConversationsStore.getState().refresh();
        useConvMediaStore.getState().reset();
        const active = useSessionStore.getState().activeConversationId;
        if (active !== null) void useMessagesStore.getState().load(active);
      }
    } catch (e) {
      toast.error("设置没有保存", e);
    }
  };

  return (
    <Page title="通用">
      <Group title="外观">
        <Row label="主题">
          <Segmented
            value={theme}
            onChange={(v) => void setTheme(v).catch((e) => toast.error("设置没有保存", e))}
            options={[
              { value: "system", label: "跟随系统" },
              { value: "light", label: "浅色" },
              { value: "dark", label: "深色" },
            ]}
          />
        </Row>
      </Group>

      <Group title="内容">
        <Row label="显示离线内容" description="磁盘未连接时，仍显示文件的缩略图">
          <Switch
            label="显示离线内容"
            checked={settings.offlineContent === "show"}
            onChange={(on) => void set("offlineContent", on ? "show" : "hide")}
          />
        </Row>
        <Row label="地图" description="底图从 OpenFreeMap 加载，需要联网">
          <Switch
            label="地图"
            checked={settings.mapTiles === "online"}
            onChange={(on) => {
              if (!on) useSessionStore.getState().setMapOpen(false);
              void set("mapTiles", on ? "online" : "off");
            }}
          />
        </Row>
      </Group>

      <Group title="统计">
        <Row label="记录观看" description="看了什么、看了多久，存在各自的库里">
          <Switch
            label="记录观看"
            checked={settings.viewStats === "on"}
            onChange={(on) => void set("viewStats", on ? "on" : "off")}
          />
        </Row>
        {lib?.unlocked && (
          <Row label="清除这个库的观看记录">
            <Button size="sm" variant="danger-secondary" onClick={() => setConfirmClear(true)}>
              清除
            </Button>
          </Row>
        )}
      </Group>

      <ConfirmDialog
        open={confirmClear}
        title="清除观看记录？"
        message={`「${lib?.name ?? ""}」的观看时长和播放次数都会删掉，不能恢复。`}
        confirmText="清除"
        variant="danger"
        busy={clearing}
        onConfirm={() => void clearStats()}
        onCancel={() => setConfirmClear(false)}
      />
    </Page>
  );
}
