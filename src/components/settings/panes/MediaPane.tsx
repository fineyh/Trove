import { Image } from "lucide-react";
import { PlaceholderPane } from "./PlaceholderPane";

export function MediaPane() {
  return (
    <PlaceholderPane
      title="媒体管理"
      message="失效文件列表与一键修复将在 Phase 5.1 上线。"
      icon={Image}
    />
  );
}
