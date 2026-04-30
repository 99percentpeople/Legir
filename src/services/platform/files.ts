import { isDesktopApp } from "./runtime";

export type FilePickerFilter = {
  name: string;
  extensions: string[];
};

export type SaveTarget =
  | { kind: "web"; handle: FileSystemFileHandle; id?: string }
  | { kind: "tauri"; path: string };

export type OpenFileResult = {
  bytes: Uint8Array;
  filePath?: string;
  handle?: FileSystemFileHandle;
  filename: string;
};

export type SavePdfResult =
  | { ok: true; kind: "download" }
  | { ok: true; kind: "saved"; target: SaveTarget }
  | { ok: false; reason: "unsupported" };

const canUseWindowPicker = (
  apiName: "showOpenFilePicker" | "showSaveFilePicker",
) => {
  return typeof window !== "undefined" && apiName in window;
};

const toWindowPickerTypes = (filters?: FilePickerFilter[]) => {
  if (!filters || filters.length === 0) return undefined;

  return filters.map((filter) => ({
    description: filter.name,
    accept: {
      [guessMimeType(filter.extensions)]: filter.extensions.map((extension) => {
        const normalized = extension.toLowerCase().replace(/^\./, "");
        return `.${normalized}` as `.${string}`;
      }),
    } as Record<`${string}/${string}`, `.${string}`[]>,
  }));
};

const toByteChunk = (bytes: Uint8Array): ArrayBuffer => {
  return bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : new Uint8Array(bytes).buffer;
};

function guessMimeType(extensions: string[]): `${string}/${string}` {
  const ext = (extensions[0] || "").toLowerCase().replace(/^\./, "");
  if (ext === "pdf") return "application/pdf";
  if (ext === "json") return "application/json";
  if (ext === "txt") return "text/plain";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "jp2") return "image/jp2";
  return "application/octet-stream";
}

const basename = (path: string) => {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
};

export const canOpenWithPicker = () => {
  return isDesktopApp() || canUseWindowPicker("showOpenFilePicker");
};

export const canSaveWithPicker = () => {
  return isDesktopApp() || canUseWindowPicker("showSaveFilePicker");
};

export const canSaveAs = () => {
  return canSaveWithPicker();
};

export const pickSaveTarget = async (options: {
  suggestedName: string;
  filters?: FilePickerFilter[];
}): Promise<SaveTarget | null> => {
  if (isDesktopApp()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const filePath = await save({
      defaultPath: options.suggestedName,
      filters: options.filters,
    });
    if (!filePath) return null;
    return { kind: "tauri", path: filePath };
  }

  if (canUseWindowPicker("showSaveFilePicker")) {
    const handle = await window.showSaveFilePicker({
      suggestedName: options.suggestedName,
      types: toWindowPickerTypes(options.filters),
    });
    return { kind: "web", handle };
  }

  return null;
};

export const writeToSaveTarget = async (
  target: SaveTarget,
  bytes: Uint8Array,
) => {
  if (target.kind === "tauri") {
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(target.path, bytes);
    return;
  }

  const writable = await target.handle.createWritable();
  await writable.write(toByteChunk(bytes));
  await writable.close();
};

export const openFileFromPath = async (
  filePath: string,
): Promise<OpenFileResult> => {
  if (!isDesktopApp()) {
    throw new Error("openFileFromPath is only available in desktop app");
  }

  const { readFile } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(filePath);
  return {
    bytes,
    filePath,
    filename: basename(filePath),
  };
};

export const openFile = async (options: {
  filters?: FilePickerFilter[];
}): Promise<OpenFileResult | null> => {
  if (isDesktopApp()) {
    const [{ open }, { readFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const selected = await open({
      multiple: false,
      directory: false,
      filters: options.filters,
    });

    if (!selected || Array.isArray(selected)) return null;

    const bytes = await readFile(selected);
    return {
      bytes,
      filePath: selected,
      filename: basename(selected),
    };
  }

  if (canUseWindowPicker("showOpenFilePicker")) {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: toWindowPickerTypes(options.filters),
    });

    const file = await handle.getFile();
    const arrayBuffer = await file.arrayBuffer();
    return {
      bytes: new Uint8Array(arrayBuffer),
      handle,
      filename: file.name,
    };
  }

  return null;
};

export const saveFileAs = async (options: {
  suggestedName: string;
  bytes: Uint8Array;
  filters?: FilePickerFilter[];
  mimeType?: string;
}): Promise<boolean> => {
  if (isDesktopApp()) {
    const [{ save }, { writeFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const filePath = await save({
      defaultPath: options.suggestedName,
      filters: options.filters,
    });

    if (!filePath) return false;

    await writeFile(filePath, options.bytes);
    return true;
  }

  if (canUseWindowPicker("showSaveFilePicker")) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: options.suggestedName,
        types: toWindowPickerTypes(options.filters),
      });
      const writable = await handle.createWritable();
      await writable.write(toByteChunk(options.bytes));
      await writable.close();
      return true;
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError"
      ) {
        return false;
      }
      throw error;
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const fallbackMimeType =
    options.mimeType ||
    (options.filters && options.filters.length > 0
      ? guessMimeType(options.filters[0].extensions)
      : "application/octet-stream");
  const blob = new Blob([new Uint8Array(options.bytes)], {
    type: fallbackMimeType,
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = options.suggestedName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return true;
};

export const savePdfBytes = async (options: {
  bytes: Uint8Array;
  filename: string;
  existingTarget?: SaveTarget | null;
}): Promise<SavePdfResult> => {
  if (options.existingTarget) {
    await writeToSaveTarget(options.existingTarget, options.bytes);
    return { ok: true, kind: "saved", target: options.existingTarget };
  }

  if (isDesktopApp() || typeof document === "undefined") {
    return { ok: false, reason: "unsupported" };
  }

  const blob = new Blob([new Uint8Array(options.bytes)], {
    type: "application/pdf",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = options.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return { ok: true, kind: "download" };
};
