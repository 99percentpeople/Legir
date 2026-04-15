import { invoke } from "@tauri-apps/api/core";

import { getPlatformMultiWindowHost } from "./multiWindow/host";
import { type PlatformFocusDocumentRequest } from "./multiWindow/types";
import { isDesktopApp, isWindowsPlatform } from "./runtime";

export type PlatformDroppedPdf =
  | {
      kind: "path";
      filePath: string;
    }
  | {
      kind: "file";
      file: File;
      handle?: FileSystemFileHandle;
    };

interface PlatformFileDropScopeOptions {
  getTargetElement?: () => HTMLElement | null;
}

const isPdfFilename = (name: string | null | undefined) => {
  return typeof name === "string" && name.trim().toLowerCase().endsWith(".pdf");
};

const getFirstDroppedPdfFile = (transfer: DataTransfer | null | undefined) => {
  const files = transfer?.files;
  if (!files || files.length === 0) return null;

  for (const file of Array.from(files)) {
    if (file.type === "application/pdf" || isPdfFilename(file.name)) {
      return file;
    }
  }

  return null;
};

type DataTransferItemWithFileSystemHandle = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
};

const getDroppedWebPdfHandle = async (
  transfer: DataTransfer | null | undefined,
): Promise<{ handle: FileSystemFileHandle; file: File } | null> => {
  const items = transfer?.items;
  if (!items || items.length === 0) return null;

  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;

    const itemWithHandle = item as DataTransferItemWithFileSystemHandle;
    if (typeof itemWithHandle.getAsFileSystemHandle !== "function") continue;

    try {
      const handle = await itemWithHandle.getAsFileSystemHandle();
      if (!handle || handle.kind !== "file") continue;

      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      if (file.type === "application/pdf" || isPdfFilename(file.name)) {
        return {
          handle: fileHandle,
          file,
        };
      }
    } catch (error) {
      console.error("Failed to read dropped file handle", error);
    }
  }

  return null;
};

const hasFileTransfer = (event: DragEvent) => {
  const types = event.dataTransfer?.types;
  return !!types && Array.from(types).includes("Files");
};

const decodeDroppedFileUrl = (raw: string) => {
  if (!raw || !raw.trim()) return null;

  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "file:") return null;

    const pathname = decodeURIComponent(parsed.pathname);
    if (isWindowsPlatform()) {
      return pathname.replace(/\//g, "\\").replace(/^\\([a-zA-Z]:\\)/, "$1");
    }

    return pathname;
  } catch {
    return null;
  }
};

const getDroppedPathFromBrowserEvent = (event: DragEvent) => {
  const transfer = event.dataTransfer;
  if (!transfer) return null;

  const uriListPath = transfer
    .getData("text/uri-list")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry && !entry.startsWith("#"))
    .map(decodeDroppedFileUrl)
    .find((entry) => typeof entry === "string" && isPdfFilename(entry));

  if (uriListPath) return uriListPath;

  const plainTextPath = decodeDroppedFileUrl(transfer.getData("text/plain"));
  if (plainTextPath && isPdfFilename(plainTextPath)) {
    return plainTextPath;
  }

  const downloadUrl = transfer.getData("DownloadURL");
  if (downloadUrl) {
    const parts = downloadUrl.split(":");
    const maybeUrl = parts.length >= 3 ? parts.slice(2).join(":") : "";
    const downloadPath = decodeDroppedFileUrl(maybeUrl);
    if (downloadPath && isPdfFilename(downloadPath)) {
      return downloadPath;
    }
  }

  return null;
};

const resolveTargetElement = (
  options?: PlatformFileDropScopeOptions,
): HTMLElement | null => {
  return options?.getTargetElement?.() ?? null;
};

const isClientPointInsideElement = (
  element: HTMLElement,
  x: number,
  y: number,
) => {
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
};

const isWebDragEventInsideTarget = (
  event: DragEvent,
  options?: PlatformFileDropScopeOptions,
) => {
  if (!options?.getTargetElement) return true;
  const targetElement = resolveTargetElement(options);
  if (!targetElement) return false;

  return isClientPointInsideElement(
    targetElement,
    event.clientX,
    event.clientY,
  );
};

const listenForBrowserFileDrop = async (
  listener: (payload: PlatformDroppedPdf) => void,
  options?: PlatformFileDropScopeOptions,
) => {
  const handleDragOver = (event: DragEvent) => {
    if (!hasFileTransfer(event)) return;
    if (!isWebDragEventInsideTarget(event, options)) return;

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  };

  const handleDrop = (event: DragEvent) => {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    const insideTarget = isWebDragEventInsideTarget(event, options);
    if (!insideTarget) return;

    const transfer = event.dataTransfer;

    void (async () => {
      if (isDesktopApp()) {
        const filePath = getDroppedPathFromBrowserEvent(event);
        if (filePath) {
          listener({
            kind: "path",
            filePath,
          });
          return;
        }
      }

      const droppedHandle = await getDroppedWebPdfHandle(transfer);
      if (droppedHandle) {
        listener({
          kind: "file",
          file: droppedHandle.file,
          handle: droppedHandle.handle,
        });
        return;
      }

      const file = getFirstDroppedPdfFile(transfer);
      if (!file) return;
      listener({
        kind: "file",
        file,
      });
    })();
  };

  window.addEventListener("dragover", handleDragOver);
  window.addEventListener("drop", handleDrop);

  return () => {
    window.removeEventListener("dragover", handleDragOver);
    window.removeEventListener("drop", handleDrop);
  };
};

const listenForBrowserFileDragState = async (
  listener: (isDraggingFiles: boolean) => void,
  options?: PlatformFileDropScopeOptions,
) => {
  let isActive = false;

  const setActive = (nextActive: boolean) => {
    if (isActive === nextActive) return;
    isActive = nextActive;
    listener(nextActive);
  };

  const handleDragEnter = (event: DragEvent) => {
    if (!hasFileTransfer(event)) return;

    if (isWebDragEventInsideTarget(event, options)) {
      event.preventDefault();
      setActive(true);
    }
  };

  const handleDragOver = (event: DragEvent) => {
    if (!hasFileTransfer(event)) return;

    const insideTarget = isWebDragEventInsideTarget(event, options);
    if (!insideTarget) {
      setActive(false);
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    setActive(true);
  };

  const handleDragLeave = (event: DragEvent) => {
    if (!hasFileTransfer(event)) return;

    if (
      event.clientX <= 0 ||
      event.clientY <= 0 ||
      event.clientX >= window.innerWidth ||
      event.clientY >= window.innerHeight
    ) {
      setActive(false);
    }
  };

  const handleDrop = (event: DragEvent) => {
    if (!hasFileTransfer(event)) return;
    setActive(false);
  };

  window.addEventListener("dragenter", handleDragEnter);
  window.addEventListener("dragover", handleDragOver);
  window.addEventListener("dragleave", handleDragLeave);
  window.addEventListener("drop", handleDrop);

  return () => {
    window.removeEventListener("dragenter", handleDragEnter);
    window.removeEventListener("dragover", handleDragOver);
    window.removeEventListener("dragleave", handleDragLeave);
    window.removeEventListener("drop", handleDrop);
  };
};

export const getPlatformUserName = async () => {
  if (!isDesktopApp()) return null;

  const name = await invoke<string | null>("get_system_username");
  return typeof name === "string" && name.trim().length > 0
    ? name.trim()
    : null;
};

export const listenForPlatformFileDrop = async (
  listener: (payload: PlatformDroppedPdf) => void,
  options?: PlatformFileDropScopeOptions,
) => {
  if (typeof window === "undefined") {
    return () => {};
  }

  return listenForBrowserFileDrop(listener, options);
};

export const reportPlatformWindowDocuments = async (sourceKeys: string[]) => {
  await getPlatformMultiWindowHost().reportWindowDocuments(sourceKeys);
};

export const requestPlatformFocusExistingDocument = async (
  sourceKey: string,
) => {
  return await getPlatformMultiWindowHost().requestFocusExistingDocument(
    sourceKey,
  );
};

export const listenForPlatformFocusDocumentRequest = async (
  listener: (payload: PlatformFocusDocumentRequest) => void,
) => {
  return await getPlatformMultiWindowHost().listenFocusDocumentRequest(
    listener,
  );
};

export const listenForPlatformFileDragState = async (
  listener: (isDraggingFiles: boolean) => void,
  options?: PlatformFileDropScopeOptions,
) => {
  if (typeof window === "undefined") {
    return () => {};
  }

  return listenForBrowserFileDragState(listener, options);
};
