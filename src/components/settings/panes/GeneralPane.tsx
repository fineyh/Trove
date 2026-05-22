import { useConversationsStore } from "../../../stores/conversations";
import { useSettingsStore } from "../../../stores/settings";
import type { MissingFileStrategy } from "../../../types";
import { cn } from "../../../lib/cn";

export function GeneralPane() {
  const settings = useSettingsStore((s) => s.settings);
  const setMissingStrategy = useSettingsStore((s) => s.setMissingStrategy);
  const refreshConvs = useConversationsStore((s) => s.refresh);

  const handleChange = async (value: MissingFileStrategy) => {
    await setMissingStrategy(value);
    await refreshConvs();
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">通用</h2>

      <section className="flex flex-col gap-2">
        <div className="text-sm font-medium">失效文件显示</div>
        <div className="text-xs text-app-muted">
          当媒体所在的卷未挂载，或文件已被外部删除时如何呈现。
        </div>
        <div className="mt-1 flex gap-2">
          <StrategyOption
            active={settings.missingFileStrategy === "hide"}
            title="隐藏"
            desc="像未存在过一样不显示，重新挂载后自动恢复"
            onClick={() => handleChange("hide")}
          />
          <StrategyOption
            active={settings.missingFileStrategy === "placeholder"}
            title="灰色占位"
            desc="保留消息位置并显示占位框"
            onClick={() => handleChange("placeholder")}
          />
        </div>
      </section>
    </div>
  );
}

interface StrategyOptionProps {
  active: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}

function StrategyOption({ active, title, desc, onClick }: StrategyOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col items-start gap-1 rounded-md border p-3 text-left transition",
        active
          ? "border-app-accent bg-app-accent/5"
          : "border-app-border hover:bg-app-subtle",
      )}
    >
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-app-muted">{desc}</span>
    </button>
  );
}
