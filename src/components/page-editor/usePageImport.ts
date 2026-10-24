import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useEditorTabRuntime } from "@/app/editorTabs/runtimeContext";
import { useLanguage } from "@/components/language-provider";
import { canPerformPdfPermissionOperation } from "@/lib/pdfPermissions";
import { useGlobalProcessingToast } from "@/hooks/useGlobalProcessingToast";
import {
  canOpenWithPicker,
  openFiles,
  openFileFromPath,
  type PlatformDroppedPdf,
} from "@/services/platform";
import {
  createPdfWorkerService,
  type PDFWorkerService,
} from "@/services/pdfService/pdfWorkerService";
import {
  startPdfOpenSession,
  type PdfOpenSession,
} from "@/services/pdfService";
import type { ImportedDocument } from "./types";

export function usePageImport(
  onLoaded: () => void,
  onLoadStart: () => void,
  owner?: PDFWorkerService | null,
) {
  const { t } = useLanguage();
  const runtime = useEditorTabRuntime();
  const [imported, setImported] = useState<ImportedDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("app.loading_pdf");
  const toastId = useId();
  useGlobalProcessingToast({
    isProcessing: loading,
    processingStatus: t(status),
    defaultMessage: t("app.loading_pdf"),
    toastId,
  });
  const task = useRef<{
    session: PdfOpenSession;
    disposePreview: () => void;
  } | null>(null);
  const committing = useRef<AbortController | null>(null);
  const result = useRef<ImportedDocument | null>(null);
  const generation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const dispose = useCallback(() => {
    generation.current++;
    task.current?.session.dispose();
    task.current?.disposePreview();
    committing.current?.abort();
    committing.current = null;
    task.current = null;
    result.current?.session?.dispose();
    result.current?.document.dispose();
    result.current?.disposePreview?.();
    result.current = null;
  }, []);
  useEffect(
    () => () => {
      dispose();
      toast.dismiss(toastId);
    },
    [dispose, toastId],
  );
  const clear = useCallback(() => {
    dispose();
    setImported(null);
    setLoading(false);
  }, [dispose]);
  const load = useCallback(
    async (
      getInput: () => Promise<{ input: File | Uint8Array; filename: string }>,
    ) => {
      clear();
      const current = generation.current;
      setStatus("app.loading_pdf");
      setLoading(true);
      onLoadStart();
      try {
        const { input, filename } = await getInput();
        if (current !== generation.current || runtime?.signal.aborted) return;
        if ((input instanceof File ? input.size : input.byteLength) === 0)
          throw new Error(t("page_editor.empty_file", { filename }));
        const worker = owner ?? createPdfWorkerService();
        const sourceId = owner ? crypto.randomUUID() : undefined;
        const disposePreview = () =>
          sourceId ? worker.unloadDocument(sourceId) : worker.destroy();
        const session = startPdfOpenSession(input, {
          workerService: worker,
          importId: sourceId,
        });
        task.current = { session, disposePreview };
        const readable = await session.readable;
        if (current !== generation.current || runtime?.signal.aborted) return;
        setStatus("app.parsing");
        const permissions = sourceId
          ? await worker.getPermissions({ docId: sourceId })
          : undefined;
        if (sourceId && !permissions)
          throw new Error("Could not read PDF permissions.");
        const document = sourceId
          ? {
              ...readable,
              documentPermissions: permissions!,
            }
          : await session.hydrate();
        if (current !== generation.current || runtime?.signal.aborted) {
          document.dispose();
          disposePreview();
          return;
        }
        if (
          !canPerformPdfPermissionOperation(
            "copy_text",
            document.documentPermissions,
          )
        )
          throw new Error(t("page_editor.source_restricted"));
        result.current = {
          document,
          filename,
          sourceId,
          disposePreview,
          session,
          worker: sourceId
            ? {
                renderPageImage: (options) =>
                  worker.renderPageImage({
                    ...options,
                    thumbnailContent: undefined,
                    docId: sourceId,
                  }),
              }
            : worker,
        };
        task.current = null;
        setImported(result.current);
        onLoaded();
      } catch (error) {
        if (current !== generation.current) return;
        clear();
        if (!(error instanceof DOMException && error.name === "AbortError"))
          toast.error(t("app.load_error"), {
            description:
              error instanceof Error ? error.message : t("page_editor.failed"),
          });
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [clear, onLoaded, onLoadStart, owner, runtime, t],
  );
  const loadDropped = useCallback(
    (file: PlatformDroppedPdf) =>
      load(async () => {
        if (file.kind === "file")
          return { input: file.file, filename: file.file.name };
        const opened = await openFileFromPath(file.filePath);
        return { input: opened.bytes, filename: opened.filename };
      }),
    [load],
  );
  const chooseFile = useCallback(async () => {
    if (!canOpenWithPicker()) {
      fileInput.current?.click();
      return;
    }
    const current = ++generation.current;
    try {
      const [file] = await openFiles({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!file || current !== generation.current || runtime?.signal.aborted)
        return;
      await load(async () => {
        if (file.kind === "tauri") {
          const opened = await openFileFromPath(file.filePath);
          return { input: opened.bytes, filename: opened.filename };
        }
        return { input: await file.handle.getFile(), filename: file.filename };
      });
    } catch (error) {
      if (
        current === generation.current &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        toast.error(t("app.load_error"));
    }
  }, [load, runtime, t]);
  // The document runtime now owns the imported resources after a successful insert.
  const release = () => {
    if (!result.current?.sourceId) result.current?.disposePreview?.();
    result.current = null;
    task.current = null;
    setImported(null);
  };
  const commit = async (indexes: number[]) => {
    const value = result.current;
    if (!value) throw new Error("Import is no longer available.");
    if (!value.sourceId || !owner) return value.document;
    if (committing.current) throw new Error("Import is already running.");
    const controller = new AbortController();
    committing.current = controller;
    setLoading(true);
    const current = generation.current;
    try {
      const hydrated = await value.session!.hydrate(indexes);
      controller.signal.throwIfAborted();
      await owner.documentCommand(
        "commitImport",
        { docId: value.sourceId, pageIndexes: indexes },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      value.document = hydrated;
      return hydrated;
    } finally {
      if (committing.current === controller) committing.current = null;
      if (current === generation.current) setLoading(false);
    }
  };
  return {
    commit,
    imported,
    loading,
    fileInput,
    clear,
    loadDropped,
    loadInput: load,
    chooseFile,
    release,
  };
}
