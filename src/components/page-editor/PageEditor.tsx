import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useEditorView, useEditorViewApi } from "@/store/useEditorView";
import { useEditorDocumentIdentityRuntime } from "@/app/editorRuntime";
import { useEditorEventBus } from "@/app/editorTabs/context";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlatformDroppedPdf } from "@/services/platform";
import { getPageId } from "@/services/pdfService/lib/pageStructure";
import {
  canAssemblePdf,
  canPerformPdfPermissionOperation,
} from "@/lib/pdfPermissions";
import { getPageView } from "@/components/workspace/lib/pageViewRotation";
import { parsePageRange, formatPageRange } from "@/utils/pageRange";
import { cn } from "@/utils/cn";
import { PageGrid } from "./PageGrid";
import { PageEditorToolbar } from "./PageEditorToolbar";
import { ImportPreview } from "./ImportPreview";
import { BlankPageOptions } from "./BlankPageOptions";
import { InsertionPosition, insertionIndex } from "./InsertionPosition";
import { usePageImport } from "./usePageImport";
import { usePageClipboard } from "./usePageClipboard";
import type { BlankPageSize, InsertPosition } from "./types";

const PageEditor = memo(function PageEditor({
  toolbarHost,
  finishHost,
}: {
  toolbarHost?: HTMLElement | null;
  finishHost?: HTMLElement | null;
}) {
  const { t } = useLanguage();
  const store = useEditorViewApi();
  const events = useEditorEventBus();
  const { workerService } = useEditorDocumentIdentityRuntime();
  const { pages, selectedPageIds, permissions } = useEditorView(
    useShallow((state) => ({
      pages: state.pages,
      selectedPageIds: state.selectedPageIds,
      permissions: state.documentPermissions,
    })),
  );
  const selection = useMemo(() => new Set(selectedPageIds), [selectedPageIds]);
  const selectedIndexes = useMemo(
    () =>
      pages.flatMap((page, index) =>
        selection.has(getPageId(page)) ? [index] : [],
      ),
    [pages, selection],
  );
  const enabled = canAssemblePdf(permissions);
  const [dialog, setDialog] = useState<"blank" | "import" | null>(null);
  const [position, setPosition] = useState<InsertPosition>("end");
  const [targetPage, setTargetPage] = useState(1);
  const [size, setSize] = useState<BlankPageSize>("a4");
  const [landscape, setLandscape] = useState(false);
  const [count, setCount] = useState(1);
  const [range, setRange] = useState("");
  const [error, setError] = useState("");
  const showImportDialog = useCallback(() => setDialog("import"), []);
  const startImport = useCallback(() => {
    setError("");
    setDialog(null);
  }, []);
  const importer = usePageImport(showImportDialog, startImport, workerService);
  const { imported, loading, fileInput, loadDropped, chooseFile } = importer;
  const initialPages = useRef(pages);
  const dropGeneration = useRef(0);
  const queue = useRef<PlatformDroppedPdf[]>([]);
  const setDropPosition = useCallback(
    (index: number) => {
      setPosition(
        index === 0
          ? "start"
          : index >= store.getState().pages.length
            ? "end"
            : "before_page",
      );
      setTargetPage(index + 1);
    },
    [store],
  );
  const clipboard = usePageClipboard({
    busy: loading || dialog !== null,
    onPaste: (file, index) => {
      dropGeneration.current++;
      queue.current = [];
      setError("");
      if (index !== undefined) setDropPosition(index);
      else
        setPosition(store.getState().selectedPageIds.length ? "after" : "end");
      void importer.loadInput(async () => {
        const input = await file;
        return { input, filename: input.name };
      });
    },
  });
  useEffect(
    () => () => {
      dropGeneration.current++;
    },
    [],
  );
  useEffect(() => {
    if (imported)
      setRange(
        formatPageRange(imported.document.pages.map((page) => page.pageIndex)),
      );
  }, [imported]);
  const at = insertionIndex(
    position,
    targetPage,
    pages.length,
    selectedIndexes,
  );
  const parsed = imported
    ? parsePageRange(range, imported.document.pages.length, { empty: "none" })
    : null;
  const referencePage =
    pages[selectedIndexes[0] ?? store.getState().currentPageIndex] ?? pages[0];
  const referenceSize = referencePage
    ? getPageView(referencePage, 0)
    : { width: 595.28, height: 841.89 };
  const baseWidth =
    size === "same" ? referenceSize.width : size === "a3" ? 841.89 : 595.28;
  const baseHeight =
    size === "same" ? referenceSize.height : size === "a3" ? 1190.55 : 841.89;
  const blankWidth = landscape
    ? Math.max(baseWidth, baseHeight)
    : Math.min(baseWidth, baseHeight);
  const blankHeight = landscape
    ? Math.min(baseWidth, baseHeight)
    : Math.max(baseWidth, baseHeight);
  const openDialog = useCallback(
    (next: "blank" | "import") => {
      const hasSelection = store.getState().selectedPageIds.length > 0;
      setError("");
      setPosition(hasSelection ? "after" : "end");
      if (next === "import") {
        queue.current = [];
        void chooseFile();
      } else {
        setSize(hasSelection ? "same" : "a4");
        const state = store.getState();
        const selected = new Set(state.selectedPageIds);
        const reference = state.pages.find((page) =>
          selected.has(getPageId(page)),
        );
        const view = reference ? getPageView(reference, 0) : null;
        setLandscape(!!view && view.width > view.height);
        setDialog(next);
      }
    },
    [chooseFile, store],
  );
  const closeDialog = () => {
    dropGeneration.current++;
    queue.current = [];
    importer.clear();
    setError("");
    setDialog(null);
  };
  const dropFiles = useCallback(
    async (files: Promise<PlatformDroppedPdf[]>, index: number) => {
      const generation = ++dropGeneration.current;
      try {
        const dropped = await files;
        if (!dropped.length || generation !== dropGeneration.current) return;
        queue.current = dropped.slice(1);
        setDropPosition(index);
        await loadDropped(dropped[0]);
      } catch (e) {
        if (generation === dropGeneration.current)
          toast.error(t("app.load_error"), {
            description:
              e instanceof Error ? e.message : t("page_editor.failed"),
          });
      }
    },
    [loadDropped, setDropPosition, t],
  );
  const run = useCallback(
    async (action: () => void | Promise<void>) => {
      try {
        await action();
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : t("page_editor.failed"));
      }
    },
    [t],
  );
  const finish = useCallback(
    (pageIndex?: number) => {
      const state = store.getState();
      state.setEditorMode(state.previousEditorMode, "select");
      if (pageIndex !== undefined || state.pages !== initialPages.current) {
        const target = pageIndex ?? state.currentPageIndex;
        store.setState({ currentPageIndex: target });
        requestAnimationFrame(() =>
          events.emit("workspace:navigatePage", {
            pageIndex: target,
            behavior: "auto",
          }),
        );
      }
    },
    [events, store],
  );
  const accept = () =>
    run(async () => {
      if (importer.loading) return;
      if (at === null) throw new Error(t("page_editor.invalid_range"));
      const state = store.getState();
      if (dialog === "blank") {
        if (!Number.isInteger(count) || count < 1 || count > 1000)
          throw new Error(t("page_editor.invalid_count"));
        state.addBlankPages({
          width: blankWidth,
          height: blankHeight,
          count,
          at,
        });
      } else if (
        dialog === "import" &&
        imported &&
        parsed?.ok &&
        parsed.pageIndices.length
      ) {
        const document = await importer.commit(parsed.pageIndices);
        state.insertPdfPages(
          {
            ...document,
            sourceId: imported.sourceId,
            indexes: parsed.pageIndices,
            source: {
              bytes: imported.document.pdfBytes,
              password: imported.document.openPassword ?? null,
              filename: imported.filename,
              pageIndexes: imported.sourceId ? parsed.pageIndices : undefined,
            },
          },
          at,
        );
        const inserted = store.getState().pages[at];
        if (inserted?.source && workerService)
          workerService.retainSourceResources(
            inserted.source.documentId,
            imported.document.dispose,
          );
        else imported.document.dispose();
        importer.release();
        const next = queue.current.shift();
        if (next) {
          setDropPosition(at + parsed.pageIndices.length);
          void importer.loadDropped(next);
          return;
        }
      } else return;
      closeDialog();
    });
  const positionControl = (
    <InsertionPosition
      position={position}
      targetPage={targetPage}
      total={pages.length}
      hasSelection={selection.size > 0}
      stacked
      onPositionChange={setPosition}
      onTargetPageChange={setTargetPage}
    />
  );
  return (
    <section
      className="bg-muted/40 flex min-h-0 flex-1 flex-col"
      data-page-editor
      aria-label={t("mode.pages")}
    >
      {toolbarHost &&
        createPortal(
          <PageEditorToolbar
            selectedPageIds={selectedPageIds}
            total={pages.length}
            enabled={enabled}
            busy={loading || dialog !== null}
            onOpen={openDialog}
            run={run}
          />,
          toolbarHost,
        )}
      {finishHost &&
        createPortal(
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 sm:h-9 sm:w-9"
            disabled={dialog !== null}
            aria-label={t("common.actions.done")}
            title={t("common.actions.done")}
            onClick={() => finish()}
          >
            <Check size={18} />
          </Button>,
          finishHost,
        )}
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            queue.current = [];
            void loadDropped({ kind: "file", file });
          }
        }}
      />
      {error && !dialog && (
        <p role="alert" className="text-destructive px-5 text-sm">
          {error}
        </p>
      )}
      <PageGrid
        onCopy={
          canPerformPdfPermissionOperation("copy_text", permissions)
            ? clipboard.copyPages
            : undefined
        }
        onPaste={enabled ? clipboard.pastePages : undefined}
        pages={pages}
        selectedPageIds={selectedPageIds}
        workerService={workerService}
        enabled={enabled && !loading && !dialog}
        onOpen={finish}
        onFilesDrop={dropFiles}
        run={run}
      />
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent
          className={cn(
            "flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0",
            dialog === "import" ? "sm:max-w-3xl" : "sm:max-w-2xl",
          )}
        >
          <DialogHeader className="shrink-0 border-b p-4 pr-12 text-left sm:p-5 sm:pr-12">
            <DialogTitle>
              {t(
                dialog === "blank" ? "page_editor.blank" : "page_editor.import",
              )}
            </DialogTitle>
            <DialogDescription>
              {t("page_editor.dialog_hint")}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
            <div className="grid gap-5">
              {dialog === "blank" && (
                <BlankPageOptions
                  size={size}
                  landscape={landscape}
                  count={count}
                  width={blankWidth}
                  height={blankHeight}
                  hasSelection={selection.size > 0}
                  onSizeChange={(next) => {
                    setSize(next);
                    if (next === "same")
                      setLandscape(referenceSize.width > referenceSize.height);
                  }}
                  onLandscapeChange={setLandscape}
                  onCountChange={setCount}
                >
                  {positionControl}
                </BlankPageOptions>
              )}
              {dialog === "import" && imported && (
                <ImportPreview
                  key={imported.filename}
                  imported={imported}
                  range={range}
                  onRangeChange={setRange}
                >
                  {positionControl}
                </ImportPreview>
              )}
              {error && (
                <p
                  role="alert"
                  className="bg-destructive/5 text-destructive border-destructive/20 rounded-md border px-3 py-2 text-sm"
                >
                  {error}
                </p>
              )}
            </div>
          </div>
          <DialogFooter className="shrink-0 flex-row justify-end border-t px-4 py-3 sm:px-5">
            <Button
              variant="outline"
              className="min-w-20"
              onClick={closeDialog}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              className="min-w-20"
              disabled={
                loading ||
                at === null ||
                (dialog === "blank"
                  ? !Number.isInteger(count) || count < 1 || count > 1000
                  : !parsed?.ok || !parsed.pageIndices.length)
              }
              onClick={accept}
            >
              {t(
                dialog === "import"
                  ? "page_editor.import"
                  : "page_editor.add_blank",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
});

export default PageEditor;
