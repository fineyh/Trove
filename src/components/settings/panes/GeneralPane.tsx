import { CloudOff, Eye, EyeOff, Globe, MapPinOff } from "lucide-react";
import { useConversationsStore } from "../../../stores/conversations";
import { useMessagesStore } from "../../../stores/messages";
import { useConvMediaStore } from "../../../stores/convMedia";
import { useSessionStore } from "../../../stores/session";
import { useSettingsStore } from "../../../stores/settings";
import { toast } from "../../../stores/toast";
import type { AppSettings } from "../../../types";
import { cn } from "../../../lib/cn";

export function GeneralPane() {
  const settings = useSettingsStore((s) => s.settings);
  const save = useSettingsStore((s) => s.save);

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
      toast.error("保存设置失败", e);
    }
  };

  return (
    <div className="flex flex-col gap-7">
      <h2 className="text-lg font-semibold">通用</h2>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CloudOff size={14} />
          离线内容
        </div>
        <div className="text-xs leading-5 text-app-muted">
          文件所在的盘（U 盘、移动硬盘、加密盘）没有连接时，它们的消息怎么显示。
          文件真的不见了（盘在、文件不在）的情况始终会显示出来，方便你找回。
        </div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <OptionCard
            active={settings.offlineContent === "show"}
            icon={<Eye size={16} />}
            title="照常显示"
            desc="用缩略图显示，标上「离线」"
            onClick={() => void set("offlineContent", "show")}
          />
          <OptionCard
            active={settings.offlineContent === "hide"}
            icon={<EyeOff size={16} />}
            title="暂时隐藏"
            desc="盘连上后自动重新出现"
            onClick={() => void set("offlineContent", "hide")}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Globe size={14} />
          地图底图
        </div>
        <div className="text-xs leading-5 text-app-muted">
          在线底图从 OpenStreetMap 下载，瓦片服务器会看到你浏览了哪些区域，也就是照片大致在哪里拍的。
        </div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <OptionCard
            active={settings.mapTiles === "online"}
            icon={<Globe size={16} />}
            title="在线底图"
            desc="显示街道和地名，需要联网"
            onClick={() => void set("mapTiles", "online")}
          />
          <OptionCard
            active={settings.mapTiles === "off"}
            icon={<MapPinOff size={16} />}
            title="不加载底图"
            desc="只显示位置标记，不联网"
            onClick={() => void set("mapTiles", "off")}
          />
        </div>
      </section>
    </div>
  );
}

interface OptionCardProps {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}

function OptionCard({ active, icon, title, desc, onClick }: OptionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3.5 text-left transition",
        active
          ? "border-app-accent bg-app-accent/[0.06] ring-4 ring-app-accent/10"
          : "border-app-border hover:bg-app-subtle",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          active ? "bg-app-accent text-white" : "bg-app-subtle text-app-fg/70",
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-app-muted">{desc}</span>
      </span>
    </button>
  );
}
