import { isTauri } from "@tauri-apps/api/core";

// File open/save abstraction.
//
// We support two runtimes:
// - Web: uses File System Access API when available, otherwise falls back to download
// - Tauri: uses native dialogs + filesystem plugin
//
// Keep platform branching in this module so the rest of the app can stay runtime-agnostic.

export type FilePickerFilter = {
  name: string;
  extensions: string[];
};
export const canOpenWithPicker = () => {
  return (
    isTauri() ||
    (typeof window !== "undefined" && "showOpenFilePicker" in window)
  );
};

export const canSaveWithPicker = () => {
  return (
    isTauri() ||
    (typeof window !== "undefined" && "showSaveFilePicker" in window)
  );
};

export type SaveTarget =
  | { kind: "web"; handle: FileSystemFileHandle }
  | { kind: "tauri"; path: string };

export const pickSaveTarget = async (options: {
  suggestedName: string;
  filters?: FilePickerFilter[];
}): Promise<SaveTarget | null> => {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const filePath = await save({
      defaultPath: options.suggestedName,
      filters: options.filters,
    });
    if (!filePath) return null;
    return { kind: "tauri", path: filePath };
  }

  if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
    const handle = await window.showSaveFilePicker({
      suggestedName: options.suggestedName,
      types:
        options.filters && options.filters.length > 0
          ? options.filters.map((f) => ({
              description: f.name,
              accept: {
                [guessMimeType(f.extensions)]: f.extensions.map((e) => {
                  const ext = e.toLowerCase().replace(/^\./, "");
                  return `.${ext}` as `.${string}`;
                }),
              } as Record<`${string}/${string}`, `.${string}`[]>,
            }))
          : undefined,
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
  const chunk: ArrayBuffer =
    bytes.buffer instanceof ArrayBuffer
      ? bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        )
      : new Uint8Array(bytes).buffer;
  await writable.write(chunk);
  await writable.close();
};

export type OpenFileResult = {
  bytes: Uint8Array;
  filePath?: string;
  handle?: FileSystemFileHandle;
  filename: string;
};

export type ExportPdfResult =
  | { ok: true; kind: "download" }
  | { ok: true; kind: "saved"; target: SaveTarget }
  | { ok: false; reason: "cancelled" | "unsupported" };

export const getStartupOpenPdfArg = async (): Promise<string | null> => {
  if (!isTauri()) return null;

  const { getMatches } = await import("@tauri-apps/plugin-cli");
  const matches = await getMatches();

  const value = matches?.args?.source.value;

  const first = Array.isArray(value) ? value[0] : value;

  if (typeof first !== "string") return null;
  return first;
};

export const openFileFromPath = async (
  filePath: string,
): Promise<OpenFileResult> => {
  if (!isTauri()) {
    throw new Error("openFileFromPath is only available in Tauri");
  }

  const { readFile } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(filePath);
  return {
    bytes,
    filePath,
    filename: basename(filePath),
  };
};

function guessMimeType(extensions: string[]): `${string}/${string}` {
  const ext = (extensions[0] || "").toLowerCase().replace(/^\./, "");
  if (ext === "pdf") return "application/pdf";
  if (ext === "json") return "application/json";
  if (ext === "txt") return "text/plain";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

const basename = (path: string) => {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
};

export const openFile = async (options: {
  filters?: FilePickerFilter[];
}): Promise<OpenFileResult | null> => {
  if (isTauri()) {
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

  if (typeof window !== "undefined" && "showOpenFilePicker" in window) {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types:
        options.filters && options.filters.length > 0
          ? options.filters.map((f) => ({
              description: f.name,
              accept: {
                [guessMimeType(f.extensions)]: f.extensions.map((e) => {
                  const ext = e.toLowerCase().replace(/^\./, "");
                  return `.${ext}` as `.${string}`;
                }),
              } as Record<`${string}/${string}`, `.${string}`[]>,
            }))
          : undefined,
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
}): Promise<boolean> => {
  if (isTauri()) {
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

  if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: options.suggestedName,
        types:
          options.filters && options.filters.length > 0
            ? options.filters.map((f) => ({
                description: f.name,
                accept: {
                  [guessMimeType(f.extensions)]: f.extensions.map(
                    (e) => `.${e}` as const,
                  ),
                },
              }))
            : undefined,
      });

      const writable = await handle.createWritable();
      const chunk: ArrayBuffer =
        options.bytes.buffer instanceof ArrayBuffer
          ? options.bytes.buffer.slice(
              options.bytes.byteOffset,
              options.bytes.byteOffset + options.bytes.byteLength,
            )
          : new Uint8Array(options.bytes).buffer;
      await writable.write(chunk);
      await writable.close();
      return true;
    } catch (err: any) {
      if (err?.name === "AbortError") return false;
      throw err;
    }
  }

  return false;
};

export const canSaveAs = () => {
  return canSaveWithPicker();
};

export const exportPdfBytes = async (options: {
  bytes: Uint8Array;
  filename: string;
  existingTarget?: SaveTarget | null;
  filters?: FilePickerFilter[];
}): Promise<ExportPdfResult> => {
  if (isTauri()) {
    const target = options.existingTarget
      ? options.existingTarget
      : await pickSaveTarget({
          suggestedName: options.filename,
          filters: options.filters,
        });
    if (!target) return { ok: false, reason: "cancelled" };

    await writeToSaveTarget(target, options.bytes);
    return { ok: true, kind: "saved", target };
  }

  if (typeof document === "undefined") {
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
