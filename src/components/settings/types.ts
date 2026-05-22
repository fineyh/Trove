import {
  Archive,
  HardDrive,
  Image,
  Info,
  Lock,
  Sliders,
  User,
  type LucideIcon,
} from "lucide-react";

export type SettingsSection =
  | "account"
  | "general"
  | "storage"
  | "media"
  | "security"
  | "backup"
  | "about";

export interface NavItem {
  key: SettingsSection;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "account", label: "账号", icon: User },
  { key: "general", label: "通用", icon: Sliders },
  { key: "storage", label: "存储", icon: HardDrive },
  { key: "media", label: "媒体管理", icon: Image },
  { key: "security", label: "安全", icon: Lock },
  { key: "backup", label: "备份", icon: Archive },
  { key: "about", label: "关于", icon: Info },
];

export const DEFAULT_SECTION: SettingsSection = "general";
