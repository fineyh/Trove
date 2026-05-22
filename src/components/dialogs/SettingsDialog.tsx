import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSessionStore } from "../../stores/session";
import { useSettingsStore } from "../../stores/settings";
import { SettingsNav } from "../settings/SettingsNav";
import { DEFAULT_SECTION, type SettingsSection } from "../settings/types";
import { AccountPane } from "../settings/panes/AccountPane";
import { GeneralPane } from "../settings/panes/GeneralPane";
import { StoragePane } from "../settings/panes/StoragePane";
import { MediaPane } from "../settings/panes/MediaPane";
import { SecurityPane } from "../settings/panes/SecurityPane";
import { BackupPane } from "../settings/panes/BackupPane";
import { AboutPane } from "../settings/panes/AboutPane";

export function SettingsDialog() {
  const open = useSessionStore((s) => s.settingsOpen);
  const setOpen = useSessionStore((s) => s.setSettingsOpen);
  const load = useSettingsStore((s) => s.load);

  const [section, setSection] = useState<SettingsSection>(DEFAULT_SECTION);

  useEffect(() => {
    if (open) {
      setSection(DEFAULT_SECTION);
      void load();
    }
  }, [open, load]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative flex h-[80vh] w-full max-w-4xl overflow-hidden rounded-lg border border-app-border bg-app-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <SettingsNav active={section} onSelect={setSection} />

        <div className="flex-1 overflow-y-auto p-6">
          <PaneSwitch section={section} />
        </div>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded text-app-muted hover:bg-app-subtle"
          aria-label="关闭"
        >
          <X size={16} />
        </button>
      </div>
    </div>
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
    case "media":
      return <MediaPane />;
    case "security":
      return <SecurityPane />;
    case "backup":
      return <BackupPane />;
    case "about":
      return <AboutPane />;
  }
}
