import { create } from "zustand";
import * as ipc from "../ipc/client";
import type { ImportProgressEvent } from "../types";

/** Live state of the single in-flight import / folder scan (the backend
 *  enforces one at a time), fed by the `import:progress` event. */
interface ImportJobState {
  /** null = idle. */
  job: ImportProgressEvent | null;
  cancelling: boolean;
  apply: (payload: ImportProgressEvent) => void;
  cancel: () => Promise<void>;
}

export const useImportJobStore = create<ImportJobState>((set) => ({
  job: null,
  cancelling: false,
  apply: (payload) => {
    if (payload.finished) {
      set({ job: null, cancelling: false });
      return;
    }
    set({ job: payload });
  },
  cancel: async () => {
    set({ cancelling: true });
    try {
      await ipc.cancelImport();
    } catch (e) {
      console.error("cancel_import failed", e);
      set({ cancelling: false });
    }
  },
}));
