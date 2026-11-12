import { useState } from 'react';
import { setDemoMode, type DemoMode } from '../api';
import { errorMessage } from '../workspace-utils';
export function useExecutionMode() {
  const [mode, setMode] = useState<DemoMode>('rest');
  const switchMode = (
    next: DemoMode,
    actions: {
      busy: boolean;
      translateDraft: (next: DemoMode) => void;
      invalidateReads: () => void;
      setError: (message: string | null) => void;
    },
  ) => {
    if (next === mode || actions.busy) return;
    try {
      // Translate first: an invalid draft stays editable in its original mode.
      actions.translateDraft(next);
    } catch (cause) {
      actions.setError(errorMessage(cause));
      return;
    }
    // Keep the tenant and selections, but invalidate reads from the old executor.
    actions.invalidateReads();
    setDemoMode(next);
    setMode(next);
    actions.setError(null);
  };
  return {
    mode,
    switchMode,
  };
}
