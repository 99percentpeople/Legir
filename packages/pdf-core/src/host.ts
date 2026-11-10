import type { PDFDocumentPermissions, PDFOutlineItem } from "@legir/pdf-model";
import type { FontRequest } from "./engine/fontHost.js";
import { hasWorkerFontProvider, requestHostFont } from "./engine/fontHost.js";
import type { DocumentCommands } from "./engine/sessionTypes.js";
export { hasWorkerFontProvider, requestHostFont } from "./engine/fontHost.js";
export type { FontRequest } from "./engine/fontHost.js";

export type PdfFontCatalog = {
  families: string[];
  aliases: Record<string, string>;
};
export type PdfLoadEvents = {
  "pdf:loadStart": { id: string; label?: string };
  "pdf:loadProgress": { id: string; loaded: number; total?: number };
  "pdf:loadEnd": { id: string; ok: boolean };
  "pdf:passwordRequired": {
    id: string;
    reason: "need_password" | "incorrect_password";
    submit: (password: string) => void;
    cancel: () => void;
  };
};

/** Only the capabilities the parser needs, not the browser worker client. */
export interface PdfHydrationServices {
  loadDocument(
    bytes: Uint8Array,
    options?: {
      password?: string;
      signal?: AbortSignal;
      onProgress?: (payload: { loaded: number; total?: number }) => void;
    },
  ): Promise<boolean>;
  getPermissions(options?: {
    signal?: AbortSignal;
  }): Promise<PDFDocumentPermissions | null | undefined>;
  getOutline(options?: {
    signal?: AbortSignal;
  }): Promise<PDFOutlineItem[] | null>;
  resolveDest(options: {
    dest: unknown;
    signal?: AbortSignal;
  }): Promise<number | null>;
  renderStampPage?: (
    pageIndex: number,
  ) => Promise<{ bytes: Uint8Array; mimeType: string } | undefined>;
}

export interface PdfContentOwner {
  documentCommand(
    type: "contentOperation",
    input: DocumentCommands["contentOperation"]["input"],
    signal?: AbortSignal,
  ): Promise<DocumentCommands["contentOperation"]["output"]>;
}

/** Configure once per JS realm (main thread / worker / server process).
 * Keep tenant/request values in document arguments, never in this host object.
 * The core never imports application state, Tauri, React or a bundler API.
 */
export interface PdfHost {
  moduleUrl?: () => string | undefined;
  resolveAssetUrl?: (path: string) => string;
  readFontAsset?: (path: string) => Promise<Uint8Array | undefined>;
  systemFontsAvailable?: () => boolean;
  getSystemFontBytes?: (
    request: FontRequest,
  ) => Promise<Uint8Array | undefined>;
  getSystemFontCatalog?: () => Promise<PdfFontCatalog>;
  emit?: <K extends keyof PdfLoadEvents>(
    event: K,
    payload: PdfLoadEvents[K],
  ) => void;
  findContentOwner?: (bytes: Uint8Array) => PdfContentOwner | undefined;
  createContentWorker?: () => Worker;
}

let host: Readonly<PdfHost> = {};
export const configurePdfHost = (capabilities: PdfHost): void => {
  host = Object.freeze({ ...host, ...capabilities });
};
export const getPdfHost = (): Readonly<PdfHost> => host;
export const getSystemFontCatalog = (): Promise<PdfFontCatalog> =>
  host.getSystemFontCatalog?.() ??
  Promise.resolve({ families: [], aliases: {} });
export const hasSystemFontProvider = (): boolean =>
  hasWorkerFontProvider() ||
  (host.systemFontsAvailable?.() ?? !!host.getSystemFontBytes);
export const getSystemFontBytes = async (
  request: FontRequest,
): Promise<Uint8Array | undefined> =>
  hasWorkerFontProvider()
    ? requestHostFont(request)
    : host.getSystemFontBytes?.(request);
export const pdfEvents = {
  emit<K extends keyof PdfLoadEvents>(
    event: K,
    payload: PdfLoadEvents[K],
  ): void {
    if (host.emit) host.emit(event, payload);
    else if (event === "pdf:passwordRequired") {
      // A headless call without an interactive host must fail, not wait forever.
      (payload as PdfLoadEvents["pdf:passwordRequired"]).cancel();
    }
  },
};
