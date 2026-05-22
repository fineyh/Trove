import { User } from "lucide-react";
import { PlaceholderPane } from "./PlaceholderPane";

export function AccountPane() {
  return (
    <PlaceholderPane
      title="账号"
      message="Google 登录将在 Phase 6 上线，支持把元数据加密备份到云端。"
      icon={User}
    />
  );
}
