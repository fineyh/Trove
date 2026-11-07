import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSessionStore } from "../../stores/session";
import { useSettingsStore } from "../../stores/settings";
import { IconButton } from "../ui/Button";
import { useEscapeLayer } from "../ui/Modal";
import { SettingsNav } from "../settings/SettingsNav";
import { DEFAULT_SECTION, isSection, type SettingsSection } from "../settings/types";
import { AccountPane } from "../settings/panes/AccountPane";
import { GeneralPane } from "../settings/panes/GeneralPane";
import { StoragePane } from "../settings/panes/StoragePane";
import { SecurityPane } from "../settings/panes/SecurityPane";
import { BackupPane } from "../settings/panes/BackupPane";
import { AboutPane } from "../settings/panes/AboutPane";

export function SettingsDialog() {
  const open = useSessionStore((s) => s.settingsOpen);
  const setOpen = useSessionStore((s) => s.setSettingsOpen);
  const initial = useSessionStore((s) => s.settingsSection);
  const load = useSettingsStore((s) => s.load);

  const [section, setSection] = useState<SettingsSection>(DEFAULT_SECTION);

  useEffect(() => {
    if (open) {
      setSection(isSection(initial) ? initial : DEFAULT_SECTION);
      void load();
    }
  }, [open, initial, load]);

  useEscapeLayer(open, () => setOpen(false));

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-black/30 p-6 dark:bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        className="relative flex h-[min(680px,88vh)] w-full max-w-[880px] animate-pop-in overflow-hidden rounded-2xl bg-app shadow-xl ring-1 ring-black/5 dark:ring-white/10"
      >
        <SettingsNav active={section} onSelect={setSection} />
        <div className="min-w-0 flex-1 overflow-y-auto px-8 pt-6">
          <PaneSwitch section={section} />
        </div>
        <IconButton
          label="关闭"
          noTip
          icon={<X size={16} />}
          onClick={() => setOpen(false)}
          className="absolute right-3 top-3"
        />
      </div>
    </div>,
    document.body,
  );
}

function PaneSwitch({ section }: { section: SettingsSection }) {
  switch (section) {
    case "account":
      return <AccountPane />;
    case "general":
      return <GeneralPane />;
    case "storage":
      return <StoragePane />;
    case "security":
      return <SecurityPane />;
    case "backup":
      return <BackupPane />;
    case "about":
      return <AboutPane />;
  }
}
