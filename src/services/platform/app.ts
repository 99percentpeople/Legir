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

export interface PlatformFileDropScopeOptions {
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

export const hasPlatformFileTransfer = (event: DragEvent) => {
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

export const isPlatformFileDropInsideScope = (
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

export const setPlatformFileDropEffect = (event: DragEvent) => {
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
};

export const readPlatformDroppedPdf = async (
  event: DragEvent,
): Promise<PlatformDroppedPdf | null> => {
  const transfer = event.dataTransfer;
  if (!transfer) return null;

  if (isDesktopApp()) {
    const filePath = getDroppedPathFromBrowserEvent(event);
    if (filePath) {
      return {
        kind: "path",
        filePath,
      };
    }
  }

  const droppedHandle = await getDroppedWebPdfHandle(transfer);
  if (droppedHandle) {
    return {
      kind: "file",
      file: droppedHandle.file,
      handle: droppedHandle.handle,
    };
  }

  const file = getFirstDroppedPdfFile(transfer);
  if (!file) return null;

  return {
    kind: "file",
    file,
  };
};

export const getPlatformUserName = async () => {
  if (!isDesktopApp()) return null;

  const name = await invoke<string | null>("get_system_username");
  return typeof name === "string" && name.trim().length > 0
    ? name.trim()
    : null;
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
