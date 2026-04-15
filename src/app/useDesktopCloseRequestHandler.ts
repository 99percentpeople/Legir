import { useCallback } from "react";

import type { EditorTabSession } from "@/app/editorTabs/types";
import type { PlatformCloseRequestEvent } from "@/services/platform";

interface UseDesktopCloseRequestHandlerOptions {
  getTabsSnapshot: () => EditorTabSession[];
  startCloseFlow: (
    scope: "close-window",
    targetTabIds: string[],
  ) => Promise<void>;
}

export const useDesktopCloseRequestHandler = ({
  getTabsSnapshot,
  startCloseFlow,
}: UseDesktopCloseRequestHandlerOptions) => {
  return useCallback(
    (event: PlatformCloseRequestEvent) => {
      const liveTabs = getTabsSnapshot();
      if (liveTabs.length === 0) return;

      const hasDirtyTabs = liveTabs.some((tab) => tab.isDirty);
      if (!hasDirtyTabs) return;

      event.preventDefault();
      void startCloseFlow(
        "close-window",
        liveTabs.map((tab) => tab.id),
      );
    },
    [getTabsSnapshot, startCloseFlow],
  );
};
