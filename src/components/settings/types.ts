import { ArchiveRestore, HardDrive, Info, ShieldCheck, SlidersHorizontal, type LucideIcon } from "lucide-react";

// "account" (Google sign-in) is hidden until it does something (R4.5); AccountPane.tsx is kept for then.
export type SettingsSection = "general" | "security" | "storage" | "backup" | "about";

export interface NavItem {
  key: SettingsSection;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "general", label: "通用", icon: SlidersHorizontal },
  { key: "security", label: "隐私与安全", icon: ShieldCheck },
  { key: "storage", label: "存储", icon: HardDrive },
  { key: "backup", label: "备份与恢复", icon: ArchiveRestore },
  { key: "about", label: "关于", icon: Info },
];

export const DEFAULT_SECTION: SettingsSection = "general";

export function isSection(s: string | null | undefined): s is SettingsSection {
  return NAV_ITEMS.some((i) => i.key === s);
}
