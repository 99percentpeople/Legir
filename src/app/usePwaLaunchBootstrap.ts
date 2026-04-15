import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  beginPwaLaunchProcessing,
  consumePendingPwaLaunchFiles,
  finishPwaLaunchProcessing,
  hasActivePwaLaunchProcessing,
  hasPendingPwaLaunchFiles,
  listenForPwaLaunchFiles,
  listenForPwaLaunchProcessing,
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
  const openWebHandleFileRef = useRef(openWebHandleFile);
  const loadErrorMessageRef = useRef(loadErrorMessage);
  const unsupportedFileMessageRef = useRef(unsupportedFileMessage);
  const [hasPendingLaunchQueueFiles, setHasPendingLaunchQueueFiles] = useState(
    () => hasPendingPwaLaunchFiles() || hasActivePwaLaunchProcessing(),
  );

  useEffect(() => {
    openWebHandleFileRef.current = openWebHandleFile;
  }, [openWebHandleFile]);

  useEffect(() => {
    loadErrorMessageRef.current = loadErrorMessage;
  }, [loadErrorMessage]);

  useEffect(() => {
    unsupportedFileMessageRef.current = unsupportedFileMessage;
  }, [unsupportedFileMessage]);

  useEffect(() => {
    let cancelled = false;
    let unlistenFiles: null | (() => void) = null;
    let unlistenProcessing: null | (() => void) = null;

    const openPwaLaunchedHandle = async (handle: FileSystemFileHandle) => {
      const file = await handle.getFile();
      if (
        file.type !== "application/pdf" &&
        !file.name.trim().toLowerCase().endsWith(".pdf")
      ) {
        toast.error(unsupportedFileMessageRef.current);
        return;
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      await openWebHandleFileRef.current({
        handle,
        filename: file.name,
        bytes,
      });
    };

    const consumeLaunchHandles = async (handles: FileSystemFileHandle[]) => {
      if (handles.length === 0) {
        if (!cancelled && !hasActivePwaLaunchProcessing()) {
          setHasPendingLaunchQueueFiles(false);
        }
        return;
      }

      beginPwaLaunchProcessing();
      if (!cancelled) {
        setHasPendingLaunchQueueFiles(true);
      }

      try {
        for (const handle of handles) {
          if (cancelled) break;
          await openPwaLaunchedHandle(handle);
        }
      } catch (error) {
        console.error("Failed to open launched PWA files", error);
        toast.error(loadErrorMessageRef.current);
      } finally {
        finishPwaLaunchProcessing();
        if (
          !cancelled &&
          !hasActivePwaLaunchProcessing() &&
          !hasPendingPwaLaunchFiles()
        ) {
          setHasPendingLaunchQueueFiles(false);
        }
      }
    };

    const initialLaunchHandles = consumePendingPwaLaunchFiles();
    if (initialLaunchHandles.length > 0) {
      void consumeLaunchHandles(initialLaunchHandles);
    } else {
      setHasPendingLaunchQueueFiles(hasActivePwaLaunchProcessing());
    }

    unlistenProcessing = listenForPwaLaunchProcessing((isProcessing) => {
      if (cancelled) return;
      setHasPendingLaunchQueueFiles(isProcessing || hasPendingPwaLaunchFiles());
    });

    void (async () => {
      unlistenFiles = await listenForPwaLaunchFiles((handles) => {
        setHasPendingLaunchQueueFiles(
          handles.length > 0 || hasActivePwaLaunchProcessing(),
        );
        void consumeLaunchHandles(handles);
      });

      if (cancelled) {
        try {
          unlistenFiles?.();
        } catch {
          // ignore
        }
        unlistenFiles = null;
      }
    })();

    return () => {
      cancelled = true;
      try {
        unlistenFiles?.();
      } catch {
        // ignore
      }
      try {
        unlistenProcessing?.();
      } catch {
        // ignore
      }
    };
  }, []);

  return hasPendingLaunchQueueFiles;
};
