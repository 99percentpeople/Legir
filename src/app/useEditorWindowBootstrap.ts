import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  acquirePendingEditorWindowBootstrap,
  finishPendingEditorWindowBootstrap,
  hasPendingEditorWindowBootstrap,
} from "@/services/platform";

interface UseEditorWindowBootstrapOptions {
  onStartupOpenDocument: (filePath: string) => Promise<void>;
  onStartupOpenWebDocument: (recentFilePath: string) => Promise<void>;
  onTabTransfer: (transferId: string) => Promise<boolean>;
  loadErrorMessage: string;
}

export const useEditorWindowBootstrap = ({
  onStartupOpenDocument,
  onStartupOpenWebDocument,
  onTabTransfer,
  loadErrorMessage,
}: UseEditorWindowBootstrapOptions) => {
  const [hasPendingWindowBootstrap, setHasPendingWindowBootstrap] = useState(
    () => hasPendingEditorWindowBootstrap(),
  );

  useEffect(() => {
    if (!hasPendingWindowBootstrap) return;

    let cancelled = false;

    void (async () => {
      const { bootstrap, completion } = acquirePendingEditorWindowBootstrap();
      if (!bootstrap) {
        await completion;
        if (!cancelled) {
          setHasPendingWindowBootstrap(false);
        }
        return;
      }

      try {
        if (bootstrap.kind === "startup-open") {
          await onStartupOpenDocument(bootstrap.filePath);
        } else if (bootstrap.kind === "startup-open-web") {
          await onStartupOpenWebDocument(bootstrap.recentFilePath);
        } else if (bootstrap.kind === "tab-transfer") {
          await onTabTransfer(bootstrap.transferId);
        }
      } catch (error) {
        console.error("Failed to consume window bootstrap:", error);
        toast.error(loadErrorMessage);
      } finally {
        finishPendingEditorWindowBootstrap();
        if (!cancelled) {
          setHasPendingWindowBootstrap(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hasPendingWindowBootstrap,
    loadErrorMessage,
    onStartupOpenDocument,
    onStartupOpenWebDocument,
    onTabTransfer,
  ]);

  return hasPendingWindowBootstrap;
};
