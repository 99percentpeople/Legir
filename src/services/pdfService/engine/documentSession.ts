import type { PDFDocument, PDFObject } from "@legir/pdfium";
import type { PDFDocument as EditingDocument } from "@cantoo/pdf-lib";
import { executePdfEngineRequest, type PDFiumModule } from "./pdfium";
import type { PdfEngineRequest } from "./types";
import { createEditingView, disposeEditingDocument } from "./editingDocument";
import {
  getNativePageViewport,
  getNativeOutline,
  getNativePermissions,
  resolveNativeDestination,
} from "./pageContent";
import { disposeNativePage } from "./raster";
import type { ExportPdfRequest, ParsedPdfModels } from "./sessionTypes";
import type { PDFWorkerService } from "../pdfWorkerService";

export type NativeSource = {
  pages: number[];
  ownedObjects?: number[];
  refs?: Map<number, number>;
  trailer?: PDFObject;
  permissions: ReturnType<typeof getNativePermissions>;
  outline: ReturnType<typeof getNativeOutline>;
};

/** One native document owns all page/resource objects in this worker. Imported
 * documents are opened only while grafting, then immediately closed. Source
 * catalogs are small views of objects in that same xref, not PDF instances. */
export class DocumentSession {
  readonly sources = new Map<string, NativeSource>();
  private nativeDocuments = 0;
  private peakNativeDocuments = 0;
  readonly document: PDFDocument;
  constructor(
    readonly pdfium: PDFiumModule,
    bytes: Uint8Array,
    password?: string,
    readonly primaryId = "default",
  ) {
    const doc = new pdfium.PDFDocument(bytes);
    try {
      if (doc.needsPassword() && !doc.authenticatePassword(password ?? ""))
        throw new Error("The PDF password is missing or incorrect.");
      this.document = doc;
      this.nativeDocuments = this.peakNativeDocuments = 1;
      this.sources.set(primaryId, {
        pages: Array.from({ length: doc.countPages() }, (_, index) => index),
        permissions: getNativePermissions(doc),
        outline: getNativeOutline(doc),
      });
      doc.enableJournal();
    } catch (error) {
      doc.destroy();
      throw error;
    }
  }

  getSource(id = this.primaryId) {
    const source = this.sources.get(id);
    if (!source) throw new Error("PDF source is not loaded.");
    return source;
  }

  async addSource(id: string, bytes: Uint8Array, password?: string) {
    if (this.sources.has(id)) return;
    const donor = new this.pdfium.PDFDocument(bytes);
    this.nativeDocuments++;
    this.peakNativeDocuments = Math.max(
      this.peakNativeDocuments,
      this.nativeDocuments,
    );
    const doc = this.document;
    let graft: ReturnType<PDFDocument["newGraftMap"]> | undefined;
    let importedTrailer: PDFObject | undefined;
    let operation = false;
    const firstObject = doc.countObjects();
    try {
      if (donor.needsPassword() && !donor.authenticatePassword(password ?? ""))
        throw new Error("The PDF password is missing or incorrect.");
      const permissions = getNativePermissions(donor),
        outline = getNativeOutline(donor);
      doc.beginOperation("Import page source");
      operation = true;
      graft = doc.newGraftMap();
      const trailer = donor.getTrailer();
      importedTrailer = doc.newDictionary();
      try {
        for (const key of ["Root", "Info", "ID"]) {
          const value = trailer.get(key);
          try {
            if (!value.isNull()) {
              const copied = graft.graftObject(value);
              try {
                importedTrailer.put(key, copied);
              } finally {
                copied.destroy();
              }
            }
          } finally {
            value.destroy();
          }
        }
      } finally {
        trailer.destroy();
      }
      const pages: number[] = [];
      const copiedPages: PDFObject[] = [];
      const firstPage = doc.countPages();
      try {
        for (let index = 0; index < donor.countPages(); index++) {
          const original = donor.findPage(index);
          const copied = graft.graftObject(original);
          try {
            // The batch materializes inherited attributes before reparenting.
            pages.push(firstPage + index);
            copiedPages.push(copied.copy());
          } finally {
            copied.destroy();
            original.destroy();
          }
        }
        doc.insertPages(-1, copiedPages);
      } finally {
        for (const page of copiedPages) page.destroy();
      }
      const refs = graft.getReferences(donor);
      doc.endOperation();
      operation = false;
      this.sources.set(id, {
        pages,
        refs,
        trailer: importedTrailer,
        permissions,
        outline,
        ownedObjects: Array.from(
          { length: doc.countObjects() - firstObject },
          (_, index) => firstObject + index,
        ),
      });
      importedTrailer = undefined;
    } finally {
      if (operation) doc.abandonOperation();
      importedTrailer?.destroy();
      graft?.destroy();
      donor.destroy();
      this.nativeDocuments--;
    }
  }

  addBlankSource(id: string, width: number, height: number) {
    if (this.sources.has(id)) return;
    if (![width, height].every((value) => Number.isFinite(value) && value > 0))
      throw new Error("Invalid blank page dimensions.");
    const doc = this.document;
    const firstObject = doc.countObjects();
    doc.beginOperation("Insert blank source");
    try {
      const page = doc.addPage([0, 0, width, height], 0, {}, "");
      const index = doc.countPages();
      try {
        doc.insertPage(-1, page);
      } finally {
        page.destroy();
      }
      this.sources.set(id, {
        pages: [index],
        outline: [],
        permissions: this.getSource().permissions,
        ownedObjects: Array.from(
          { length: doc.countObjects() - firstObject },
          (_, index) => firstObject + index,
        ),
      });
      doc.endOperation();
    } catch (error) {
      doc.abandonOperation();
      throw error;
    }
  }

  removeSource(id: string) {
    if (id === this.primaryId)
      throw new Error("Cannot remove the primary source.");
    const source = this.sources.get(id);
    if (!source) return;
    const removed = [...source.pages].sort((a, b) => b - a);
    const doc = this.document;
    doc.beginOperation("Release page source");
    try {
      doc.deletePages(removed);
      for (const number of source.ownedObjects ?? []) doc.deleteObject(number);
      doc.endOperation();
    } catch (error) {
      doc.abandonOperation();
      throw error;
    }
    source.trailer?.destroy();
    this.sources.delete(id);
    for (const remaining of this.sources.values())
      remaining.pages = remaining.pages.map(
        (index) => index - removed.filter((page) => page < index).length,
      );
    doc.setPageTreeCache(false);
    // The native allocator/journal can retain released storage until the worker
    // closes; documentStats reports arena capacity, not resident/live bytes.
  }

  loadPage(id: string, index: number) {
    const actual = this.getSource(id).pages[index];
    if (actual === undefined)
      throw new Error("PDF page index is out of range.");
    return this.document.loadPage(actual);
  }

  private view(id: string) {
    const source = this.getSource(id);
    return createEditingView(this.pdfium, this.document, {
      refs: source.refs,
      trailer: source.trailer
        ? this.document._fromPDFObjectKeep(source.trailer.pointer)
        : undefined,
    });
  }

  /** Draft/export mutations are transactional on the shared instance. The UI
   * snapshot is immutable for the job; success, failure and cancellation all
   * restore its source state without serializing/reopening the document. */
  async transaction<T>(
    id: string,
    run: (view: EditingDocument) => Promise<T>,
    keepAllSources = false,
  ): Promise<T> {
    const doc = this.document;
    doc.beginOperation("Editor document operation");
    let view: EditingDocument | undefined;
    try {
      // Trim the page tree before assembly while retaining form/link/outline
      // objects. Rollback restores the full source bank after the job.
      if (!keepAllSources && id === this.primaryId && this.sources.size > 1) {
        const retained = new Set(this.getSource(id).pages);
        doc.deletePages(
          Array.from({ length: doc.countPages() }, (_, index) => index).filter(
            (index) => !retained.has(index),
          ),
        );
      }
      view = this.view(id);
      return await run(view);
    } finally {
      if (view) disposeEditingDocument(view);
      doc.abandonOperation();
      doc.setPageTreeCache(false);
    }
  }

  async inspect() {
    const source = this.getSource();
    const pages = source.pages.map((_, pageIndex) => {
      const page = this.loadPage(this.primaryId, pageIndex);
      try {
        const viewport = getNativePageViewport(page);
        return {
          pageIndex,
          width: viewport.width,
          height: viewport.height,
          viewBox: viewport.viewBox!,
          userUnit: viewport.userUnit ?? 1,
          rotation: viewport.rotation,
        };
      } finally {
        disposeNativePage(page);
      }
    });
    return { pages, metadata: {} };
  }

  async parse(
    input: {
      fontCatalog?: { families: string[]; aliases: Record<string, string> };
    },
    renderStamp: (
      pageIndex: number,
    ) => Promise<{ bytes: Uint8Array; mimeType: string } | undefined>,
    signal?: AbortSignal,
  ): Promise<ParsedPdfModels> {
    const { loadPDFInternal } = await import("../documentPipeline");
    return this.transaction(this.primaryId, async (view) => {
      const fonts: ParsedPdfModels["fonts"] = [];
      const source = this.getSource();
      const services = {
        loadDocument: async () => true,
        getPermissions: async () => source.permissions,
        getOutline: async () => source.outline,
        resolveDest: async ({ dest }: { dest: unknown }) =>
          resolveNativeDestination(this.document, dest),
        renderStampPage: renderStamp,
      } as unknown as PDFWorkerService;
      const result = await loadPDFInternal(new Uint8Array([0]), {
        editingDocument: view,
        workerService: services,
        signal,
        fontCatalog: input.fontCatalog,
        collectFont: (family, bytes) => fonts.push({ family, bytes }),
      });
      return {
        pages: result.pages,
        fields: result.fields,
        annotations: result.annotations,
        preservedSourceAnnotations: result.preservedSourceAnnotations,
        metadata: result.metadata,
        documentPermissions: result.documentPermissions,
        outline: result.outline,
        fonts,
      };
    });
  }

  async export(request: ExportPdfRequest, signal?: AbortSignal) {
    for (const [id, source] of Object.entries(
      request.options?.pageStructure?.sources ?? {},
    )) {
      signal?.throwIfAborted();
      if (id !== this.primaryId)
        await this.addSource(id, source.bytes, source.password ?? undefined);
    }
    const { exportPDF } = await import("../documentPipeline");
    return this.transaction(this.primaryId, async (view) => {
      const borrowed: EditingDocument[] = [];
      try {
        return await exportPDF(
          new Uint8Array([0]),
          request.fields,
          request.metadata,
          request.annotations,
          request.customFont,
          {
            ...request.options,
            editingDocument: view,
            resolveSource: async (id) => {
              if (id === this.primaryId) return view;
              const source = this.view(id);
              borrowed.push(source);
              return source;
            },
          },
        );
      } finally {
        for (const source of borrowed) disposeEditingDocument(source);
      }
    });
  }

  async content(request: PdfEngineRequest) {
    return this.transaction(this.primaryId, async () =>
      executePdfEngineRequest(this.pdfium, request, this.document),
    );
  }

  stats() {
    return {
      nativeDocuments: this.nativeDocuments,
      peakNativeDocuments: this.peakNativeDocuments,
      sources: this.sources.size,
      wasmCapacityBytes: this.pdfium.memory(),
    };
  }

  dispose() {
    for (const source of this.sources.values()) source.trailer?.destroy();
    this.sources.clear();
    this.document.destroy();
    this.nativeDocuments = 0;
  }
}
