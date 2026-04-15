import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  clearPwaLaunchRouteHint,
  consumePendingPwaLaunchFiles,
  hasPendingPwaLaunchFiles,
  hasPwaLaunchRouteHint,
  listenForPwaLaunchFiles,
  PWA_LAUNCH_ROUTE_WAIT_MS,
} from "@/services/platform";

type OpenWebHandleFileOptions = {
  handle: FileSystemFileHandle;
  filename: string;
  bytes: Uint8Array;
  path?: string;
};

interface UsePwaLaunchBootstrapOptions {
  openWebHandleFile: (options: OpenWebHandleFileOptions) => Promise<void>;
  loadErrorMessage: string;
  unsupportedFileMessage?: string;
}

export const usePwaLaunchBootstrap = ({
  openWebHandleFile,
  loadErrorMessage,
  unsupportedFileMessage = "Only PDF files are supported.",
}: UsePwaLaunchBootstrapOptions) => {
  const [hasPendingLaunchQueueFiles, setHasPendingLaunchQueueFiles] = useState(
    () => hasPendingPwaLaunchFiles() || hasPwaLaunchRouteHint(),
  );

  const openPwaLaunchedHandle = useCallback(
    async (handle: FileSystemFileHandle) => {
      const file = await handle.getFile();
      if (
        file.type !== "application/pdf" &&
        !file.name.trim().toLowerCase().endsWith(".pdf")
      ) {
        toast.error(unsupportedFileMessage);
        return;
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      await openWebHandleFile({
        handle,
        filename: file.name,
        bytes,
      });
    },
    [openWebHandleFile, unsupportedFileMessage],
  );

  useEffect(() => {
    let cancelled = false;
    let unlisten: null | (() => void) = null;
    let launchHintTimeoutId: number | null = null;

    const consumeLaunchHandles = async (handles: FileSystemFileHandle[]) => {
      if (handles.length === 0) {
        if (!cancelled) {
          clearPwaLaunchRouteHint();
          setHasPendingLaunchQueueFiles(false);
        }
        return;
      }

      try {
        for (const handle of handles) {
          if (cancelled) return;
          await openPwaLaunchedHandle(handle);
        }
      } catch (error) {
        console.error("Failed to open launched PWA files", error);
        toast.error(loadErrorMessage);
      } finally {
        if (!cancelled) {
          clearPwaLaunchRouteHint();
          setHasPendingLaunchQueueFiles(false);
        }
      }
    };

    const initialLaunchHandles = consumePendingPwaLaunchFiles();
    if (initialLaunchHandles.length > 0) {
      void consumeLaunchHandles(initialLaunchHandles);
    } else if (hasPwaLaunchRouteHint()) {
      launchHintTimeoutId = window.setTimeout(() => {
        if (cancelled) {
          return;
        }

        clearPwaLaunchRouteHint();
        setHasPendingLaunchQueueFiles(false);
      }, PWA_LAUNCH_ROUTE_WAIT_MS);
    } else {
      setHasPendingLaunchQueueFiles(false);
    }

    void (async () => {
      unlisten = await listenForPwaLaunchFiles((handles) => {
        if (launchHintTimeoutId !== null) {
          window.clearTimeout(launchHintTimeoutId);
          launchHintTimeoutId = null;
        }

        setHasPendingLaunchQueueFiles(handles.length > 0);
        void consumeLaunchHandles(handles);
      });

      if (cancelled) {
        try {
          unlisten?.();
        } catch {
          // ignore
        }
        unlisten = null;
      }
    })();

    return () => {
      cancelled = true;
      if (launchHintTimeoutId !== null) {
        window.clearTimeout(launchHintTimeoutId);
      }
      try {
        unlisten?.();
      } catch {
        // ignore
      }
    };
  }, [loadErrorMessage, openPwaLaunchedHandle]);

  return hasPendingLaunchQueueFiles;
};
