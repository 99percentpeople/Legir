import {
  getIndexedDbRecentFileHandle,
  upsertIndexedDbRecentFile,
} from "./indexedDbStore";
import { renderPdfPreviewDataUrl } from "@/services/recentFilePreview";
import type { RecentFileEntry } from "./types";

const ensureReadPermission = async (handle: FileSystemFileHandle) => {
  if (typeof handle.queryPermission === "function") {
    const current = await handle.queryPermission({ mode: "read" });
    if (current === "granted") return true;
  }

  if (typeof handle.requestPermission === "function") {
    const requested = await handle.requestPermission({ mode: "read" });
    return requested === "granted";
  }

  return true;
};

type WindowWithIdleCallback = Window &
  typeof globalThis & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout?: number },
    ) => number;
  };

const scheduleBackgroundWork = (work: () => void, timeout = 1000) => {
  const browserWindow = window as WindowWithIdleCallback;

  if (typeof browserWindow.requestIdleCallback === "function") {
    browserWindow.requestIdleCallback(work, { timeout });
    return;
  }

  window.setTimeout(work, 250);
};

export const rememberWebRecentFile = async (options: {
  handle: FileSystemFileHandle;
  path?: string;
  filename?: string;
  pdfBytes?: Uint8Array;
  forcePreviewRender?: boolean;
  lastOpenedAt?: number;
}) => {
  const filename =
    options.filename?.trim() || options.handle.name || "document.pdf";
  const entries = await upsertIndexedDbRecentFile({
    path: options.path,
    handle: options.handle,
    filename,
    locationLabel: filename,
    lastOpenedAt: options.lastOpenedAt,
  });
  const persistedPath = entries[0]?.path ?? options.path;

  if (
    persistedPath &&
    options.pdfBytes &&
    (options.forcePreviewRender || !entries[0]?.previewDataUrl)
  ) {
    scheduleBackgroundWork(() => {
      void (async () => {
        try {
          const previewDataUrl = await renderPdfPreviewDataUrl({
            pdfBytes: options.pdfBytes,
            targetWidth: 240,
            renderAnnotations: true,
          });
          if (!previewDataUrl) return;

          await upsertIndexedDbRecentFile({
            path: persistedPath,
            handle: options.handle,
            filename,
            locationLabel: filename,
            previewDataUrl,
            previewUpdatedAt: Date.now(),
          });
        } catch (error) {
          console.error("Failed to render web recent file preview", error);
        }
      })();
    });
  }

  return entries;
};

export const readWebRecentFile = async (entry: RecentFileEntry) => {
  const handle = await getIndexedDbRecentFileHandle(entry.path);
  if (!handle) {
    throw new Error("Missing browser file handle for this recent item.");
  }

  const canRead = await ensureReadPermission(handle);
  if (!canRead) {
    throw new Error("Read permission was denied for this file.");
  }

  const file = await handle.getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());

  return {
    handle,
    file,
    bytes,
  };
};
