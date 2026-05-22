import { Archive } from "lucide-react";
import { PlaceholderPane } from "./PlaceholderPane";

export function BackupPane() {
  return (
    <PlaceholderPane
      title="备份"
      message="导出 / 导入 .trovebackup 备份包将在 Phase 6 上线。"
      icon={Archive}
    />
  );
}
