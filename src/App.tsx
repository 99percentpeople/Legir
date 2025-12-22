import React, { useEffect, useCallback, useState } from "react";
import LandingPage from "./pages/LandingPage";
import KeyboardShortcutsHelp from "./components/KeyboardShortcutsHelp";
import SettingsDialog from "./components/SettingsDialog";
import AIDetectionDialog, {
  AIDetectionOptions,
} from "./components/AIDetectionDialog";
import EditorPage from "./pages/EditorPage";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "./components/ui/dialog";
import { Button } from "./components/ui/button";
import { EditorState, FormField } from "./types";
import {
  loadPDF,
  exportPDF,
  renderPage,
  renderPdfThumbnailFromPage,
  renderPdfThumbnailFromPdfBytes,
} from "./services/pdfService";
import { analyzePageForFields } from "./services/geminiService";
import { saveDraft, getDraft, clearDraft } from "./services/storageService";
import { DEFAULT_FIELD_STYLE } from "./constants";
import {
  exportPdfBytes,
  openFileFromPath,
  getStartupOpenPdfArg,
  openFile,
  pickSaveTarget,
  writeToSaveTarget,
} from "./services/fileOps";
import { useLanguage } from "./components/language-provider";
import { toast } from "sonner";
import { useEditorStore, type EditorActions } from "./store/useEditorStore";
import { useLocation } from "wouter";
import AppRoutes from "./AppRoutes";
import {
  addRecentFile,
  setRecentFileThumbnail,
} from "./services/recentFilesService";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

// App orchestrator (not just UI).
//
// This file coordinates the main user journeys:
// - Open/parse a PDF -> populate the editor store
// - Render landing/editor routes
// - Save/export (Web vs Tauri) via `fileOps`
// - Web draft persistence via `storageService`
// - AI field detection via `geminiService`
//
// Rule of thumb:
// - Rendering/interaction logic lives in `pages/EditorPage.tsx` and `components/workspace/Workspace.tsx`.
// - Authoritative editor state lives in `store/useEditorStore.ts`.
// - PDF import/export pipeline lives in `services/pdfService.ts`.
function useAppInitialization({
  loadIntoEditor,
  setState,
  pdfDisposeRef,
  openDroppedPdfPath,
  setPendingFileDropPath,
  setFileDropDialogOpen,
}: {
  loadIntoEditor: (options: {
    input: File | Uint8Array;
    pdfFile: File | null;
    filename: string;
    saveTarget: EditorState["saveTarget"] | null;
  }) => Promise<void>;
  setState: EditorActions["setState"];
  pdfDisposeRef: React.RefObject<null | (() => void)>;
  openDroppedPdfPath: (filePath: string) => Promise<void>;
  setPendingFileDropPath: React.Dispatch<React.SetStateAction<string | null>>;
  setFileDropDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  useEffect(() => {
    let cancelled = false;
    let unlisten: null | (() => void) = null;

    void (async () => {
      try {
        const startupPath = await getStartupOpenPdfArg();
        if (!cancelled && startupPath) {
          const picked = await openFileFromPath(startupPath);
          if (cancelled) return;
          await loadIntoEditor({
            input: picked.bytes,
            pdfFile: null,
            filename: picked.filename,
            saveTarget: { kind: "tauri", path: startupPath },
          });
        }
      } catch (e) {
        console.error("Failed to fetch pending argv PDF:", e);
      }

      try {
        const draft = await getDraft();
        if (!cancelled && draft) setState({ hasSavedSession: true });
      } catch {
        // ignore
      }

      if (!isTauri() || cancelled) return;
      try {
        if (cancelled) return;
        const webview = getCurrentWebview();
        unlisten = await webview.onDragDropEvent((event: any) => {
          const payload: any = event?.payload;
          if (payload?.type !== "drop") return;

          const paths: string[] = Array.isArray(payload?.paths)
            ? payload.paths
            : [];
          const firstPdf = paths.find((p) => typeof p === "string") || null;
          if (!firstPdf) return;

          const { isProcessing, pages } = useEditorStore.getState();
          if (isProcessing) return;

          const hasOpenDocument = pages.length > 0;
          if (!hasOpenDocument) {
            void openDroppedPdfPath(firstPdf);
            return;
          }

          setPendingFileDropPath(firstPdf);
          setFileDropDialogOpen(true);
        });

        if (cancelled) {
          try {
            unlisten?.();
          } catch {
            // ignore
          }
          unlisten = null;
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
      try {
        unlisten?.();
      } catch {
        // ignore
      }
      pdfDisposeRef.current?.();
      pdfDisposeRef.current = null;
    };
  }, [
    loadIntoEditor,
    openDroppedPdfPath,
    pdfDisposeRef,
    setFileDropDialogOpen,
    setPendingFileDropPath,
    setState,
  ]);
}

const App: React.FC = () => {
  const { t } = useLanguage();

  const isTauriSaveTarget = (
    target: any,
  ): target is { kind: "tauri"; path: string } => {
    return target?.kind === "tauri" && typeof target?.path === "string";
  };

  const [, navigate] = useLocation();

  // Use Zustand store
  const state = useEditorStore();
  const {
    setState,
    getPageCached,
    saveCheckpoint,
    resetDocument,
    setProcessingStatus,
    withProcessing,
    loadDocument,
  } = state;
  const pdfDisposeRef = React.useRef<null | (() => void)>(null);
  const loadQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const thumbnailQueueRef = React.useRef<Promise<void>>(Promise.resolve());

  const [fileDropDialogOpen, setFileDropDialogOpen] = useState(false);
  const [pendingFileDropPath, setPendingFileDropPath] = useState<string | null>(
    null,
  );

  const loadIntoEditor = useCallback(
    async (options: {
      input: File | Uint8Array;
      pdfFile: File | null;
      filename: string;
      saveTarget: EditorState["saveTarget"] | null;
    }) => {
      // Main import pipeline entry.
      //
      // Important invariants:
      // - Must cleanup previous pdfjs document + embedded font faces (see `pdfDisposeRef`).
      // - Must reset store before loading, but preserve cross-document UI bits (e.g. `hasSavedSession`).
      // - All heavy work should be wrapped by `withProcessing()` so UI can display status/spinners.
      const run = async () => {
        const prevPdfDocument = useEditorStore.getState().pdfDocument;
        const prevHasSavedSession = useEditorStore.getState().hasSavedSession;

        resetDocument();
        setState({ hasSavedSession: prevHasSavedSession });

        await withProcessing(t("app.parsing"), async () => {
          if (typeof requestAnimationFrame === "function") {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
          }

          await Promise.race([
            thumbnailQueueRef.current.catch(() => {
              // ignore
            }),
            new Promise<void>((resolve) => setTimeout(resolve, 80)),
          ]);

          if (prevPdfDocument) {
            try {
              prevPdfDocument.cleanup();
              await prevPdfDocument.destroy();
            } catch {
              // ignore
            }
          }

          pdfDisposeRef.current?.();
          pdfDisposeRef.current = null;

          if (typeof requestAnimationFrame === "function") {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
          }

          const {
            pdfBytes,
            pdfDocument,
            pages,
            fields,
            annotations,
            metadata,
            outline,
            dispose,
          } = await loadPDF(options.input);
          pdfDisposeRef.current = dispose;

          loadDocument({
            pdfFile: options.pdfFile,
            pdfBytes,
            pdfDocument,
            metadata,
            filename: options.filename,
            saveTarget: options.saveTarget,
            pages,
            fields,
            annotations,
            outline,
            scale: 1.0,
          });

          if (options.saveTarget?.kind === "tauri") {
            const tauriPath = options.saveTarget.path;
            const expectedPdfDocument = pdfDocument;
            addRecentFile({
              path: tauriPath,
              filename: options.filename,
            });

            thumbnailQueueRef.current = thumbnailQueueRef.current
              .catch(() => {
                // keep queue alive
              })
              .then(async () => {
                try {
                  const expectedPdfBytes = pdfBytes;
                  const pageProxy = await useEditorStore
                    .getState()
                    .getPageCached(0);

                  const currentPdfDocument =
                    useEditorStore.getState().pdfDocument;
                  const currentPdfBytes = useEditorStore.getState().pdfBytes;
                  if (currentPdfDocument !== expectedPdfDocument) return;
                  if (currentPdfBytes !== expectedPdfBytes) return;

                  const thumb = await renderPdfThumbnailFromPage({
                    page: pageProxy,
                    targetWidth: 240,
                  });
                  if (!thumb) return;

                  const latestPdfDocument =
                    useEditorStore.getState().pdfDocument;
                  const latestPdfBytes = useEditorStore.getState().pdfBytes;
                  if (latestPdfDocument !== expectedPdfDocument) return;
                  if (latestPdfBytes !== expectedPdfBytes) return;

                  setRecentFileThumbnail({
                    path: tauriPath,
                    thumbnailDataUrl: thumb,
                  });
                } catch {
                  // ignore
                }
              });
          }

          navigate("/editor");
        }).catch((error) => {
          console.error("Error loading PDF:", error);
          toast.error(t("app.load_error"));
        });
      };

      loadQueueRef.current = loadQueueRef.current
        .catch(() => {
          // keep queue alive
        })
        .then(run);
      return loadQueueRef.current;
    },
    [navigate, setState, t],
  );

  const handleUpload = async (file: File) => {
    await loadIntoEditor({
      input: file,
      pdfFile: file,
      filename: file.name,
      saveTarget: null,
    });
  };

  const handleOpen = async () => {
    const picked = await openFile({
      filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    });
    if (!picked) return;

    await loadIntoEditor({
      input: picked.bytes,
      pdfFile: null,
      filename: picked.filename,
      saveTarget: picked.filePath
        ? { kind: "tauri", path: picked.filePath }
        : picked.handle
          ? { kind: "web", handle: picked.handle }
          : null,
    });
  };

  const handleOpenRecent = useCallback(
    async (filePath: string) => {
      const picked = await openFileFromPath(filePath);
      await loadIntoEditor({
        input: picked.bytes,
        pdfFile: null,
        filename: picked.filename,
        saveTarget: { kind: "tauri", path: filePath },
      });
    },
    [loadIntoEditor],
  );

  const openDroppedPdfPath = useCallback(
    async (filePath: string) => {
      if (!filePath.toLowerCase().endsWith(".pdf")) {
        toast.error("Only PDF files are supported.");
        return;
      }

      await handleOpenRecent(filePath);
    },
    [handleOpenRecent],
  );

  useAppInitialization({
    loadIntoEditor,
    setState,
    pdfDisposeRef,
    openDroppedPdfPath,
    setPendingFileDropPath,
    setFileDropDialogOpen,
  });

  const handleResumeSession = async () => {
    const draft = await getDraft();
    if (!draft) return;
    await withProcessing(t("app.loading_draft"), async () => {
      pdfDisposeRef.current?.();
      pdfDisposeRef.current = null;

      // Re-load the PDF document from bytes as it is not serializable in DB
      const {
        pdfDocument,
        pages,
        annotations: fileAnnotations,
        outline,
        dispose,
      } = await loadPDF(draft.pdfBytes);
      pdfDisposeRef.current = dispose;

      loadDocument({
        pdfFile: null,
        pdfBytes: draft.pdfBytes,
        pdfDocument,
        pages,
        outline,
        fields: draft.fields,
        annotations: draft.annotations || fileAnnotations,
        metadata: draft.metadata,
        filename: draft.filename,
        saveTarget: null,
        scale: 1.0,
      });

      navigate("/editor");
    }).catch((error) => {
      console.error("Failed to resume session:", error);
      toast.error(t("app.load_error"));
    });
  };

  const handleAdvancedDetect = async (options: AIDetectionOptions) => {
    if (state.pages.length === 0 || !state.pdfDocument) return;

    // Parse the page range from options
    const targetPageIndices = (() => {
      const range = options.pageRange;
      const totalPages = state.pages.length;
      if (!range || range.toLowerCase() === "all") {
        return Array.from({ length: totalPages }, (_, i) => i);
      }

      const pages = new Set<number>();
      const parts = range.split(",");
      for (const part of parts) {
        const p = part.trim();
        if (!p) continue;

        if (p.includes("-")) {
          const [start, end] = p.split("-").map((n) => parseInt(n));
          if (!isNaN(start) && !isNaN(end)) {
            for (let i = start; i <= end; i++) {
              if (i >= 1 && i <= totalPages) pages.add(i - 1);
            }
          }
        } else {
          const num = parseInt(p);
          if (!isNaN(num) && num >= 1 && num <= totalPages) {
            pages.add(num - 1);
          }
        }
      }
      return Array.from(pages).sort((a, b) => a - b);
    })();

    if (targetPageIndices.length === 0) {
      toast.error("Invalid page range selected.");
      return;
    }

    await withProcessing(null, async () => {
      let allNewFields: FormField[] = [];

      for (let i = 0; i < targetPageIndices.length; i++) {
        const pageIndex = targetPageIndices[i];
        const page = state.pages[pageIndex];

        setProcessingStatus(
          t("app.analyzing", {
            current: i + 1,
            total: targetPageIndices.length,
          }),
        );

        const pageProxy = await getPageCached(pageIndex);
        const base64Image = await renderPage(pageProxy);

        if (base64Image) {
          const fields = await analyzePageForFields(
            base64Image,
            page.pageIndex,
            page.width,
            page.height,
            [],
            {
              allowedTypes:
                options.allowedTypes.length > 0
                  ? options.allowedTypes
                  : undefined,
              extraPrompt: options.extraPrompt,
            },
          );

          // Apply custom style if needed
          if (options.useCustomStyle) {
            fields.forEach((f) => {
              f.style = { ...f.style, ...options.defaultStyle };
            });
          }

          allNewFields = [...allNewFields, ...fields];
        }
      }

      if (allNewFields.length > 0) {
        saveCheckpoint();
        setState((prev) => ({
          ...prev,
          fields: [...prev.fields, ...allNewFields],
          isDirty: true,
        }));
      } else {
        toast.info(t("app.no_new_fields"));
      }
    }).catch((e) => {
      console.error(e);
      toast.error(t("app.auto_detect_fail", { error: e.message }));
    });
  };

  const generatePDF = async () => {
    if (!state.pdfBytes) return null;
    return await exportPDF(
      state.pdfBytes,
      state.fields,
      state.metadata,
      state.annotations,
    );
  };

  const handleSaveAs = async (): Promise<boolean> => {
    if (!state.pdfBytes) return false;
    return await withProcessing(t("app.generating"), async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const modifiedBytes = await generatePDF();
      if (!modifiedBytes) return false;

      const target = await pickSaveTarget({
        suggestedName: state.filename || "document.pdf",
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });
      if (!target) return false;

      await writeToSaveTarget(target, modifiedBytes);
      setState({
        saveTarget: target as unknown as EditorState["saveTarget"],
        lastSavedAt: new Date(),
        isDirty: false,
      });

      if (isTauriSaveTarget(target)) {
        const tauriTarget = target;
        const expectedPdfDocument = state.pdfDocument;
        addRecentFile({
          path: tauriTarget.path,
          filename: state.filename || "document.pdf",
        });
        thumbnailQueueRef.current = thumbnailQueueRef.current
          .catch(() => {
            // keep queue alive
          })
          .then(async () => {
            try {
              if (!expectedPdfDocument) return;
              if (
                useEditorStore.getState().pdfDocument !== expectedPdfDocument
              ) {
                return;
              }
              const thumb = await renderPdfThumbnailFromPdfBytes({
                pdfBytes: modifiedBytes,
                targetWidth: 240,
                renderAnnotations: true,
              });
              if (!thumb) return;
              setRecentFileThumbnail({
                path: tauriTarget.path,
                thumbnailDataUrl: thumb,
              });
            } catch {
              // ignore
            }
          });
      }

      toast.success(t("app.save_success"));
      return true;
    }).catch((err: any) => {
      if (err?.name === "AbortError") return false;
      console.error("Save As failed:", err);
      toast.error(t("app.save_fail"));
      return false;
    });
  };

  const handleExport = async (): Promise<boolean> => {
    return await withProcessing(t("app.generating"), async () => {
      const modifiedBytes = await generatePDF();
      if (!modifiedBytes) return false;

      const result = await exportPdfBytes({
        bytes: modifiedBytes,
        filename: state.filename || "document.pdf",
        existingTarget: state.saveTarget,
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });

      if (!result.ok) return false;

      if (result.kind === "saved") {
        setState({
          saveTarget: result.target as unknown as EditorState["saveTarget"],
          lastSavedAt: new Date(),
          isDirty: false,
        });

        const savedTarget = result.target;
        if (isTauriSaveTarget(savedTarget)) {
          const expectedPdfDocument = state.pdfDocument;
          addRecentFile({
            path: savedTarget.path,
            filename: state.filename || "document.pdf",
          });
          thumbnailQueueRef.current = thumbnailQueueRef.current
            .catch(() => {
              // keep queue alive
            })
            .then(async () => {
              try {
                if (!expectedPdfDocument) return;
                if (
                  useEditorStore.getState().pdfDocument !== expectedPdfDocument
                ) {
                  return;
                }
                const thumb = await renderPdfThumbnailFromPdfBytes({
                  pdfBytes: modifiedBytes,
                  targetWidth: 240,
                  renderAnnotations: true,
                });
                if (!thumb) return;
                setRecentFileThumbnail({
                  path: savedTarget.path,
                  thumbnailDataUrl: thumb,
                });
              } catch {
                // ignore
              }
            });
        }

        toast.success(t("app.save_success"));
      }

      return true;
    }).catch((error) => {
      console.error("Export failed:", error);
      toast.error(t("app.export_fail"));
      return false;
    });
  };

  const handlePrint = async () => {
    await withProcessing(t("app.generating"), async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const modifiedBytes = await generatePDF();
      if (modifiedBytes) {
        const blob = new Blob([new Uint8Array(modifiedBytes)], {
          type: "application/pdf",
        });
        const url = URL.createObjectURL(blob);

        const iframe = document.createElement("iframe");
        iframe.style.position = "fixed";
        iframe.style.right = "0";
        iframe.style.bottom = "0";
        iframe.style.width = "0";
        iframe.style.height = "0";
        iframe.style.border = "0";
        iframe.src = url;

        document.body.appendChild(iframe);

        iframe.onload = () => {
          const win = iframe.contentWindow;
          if (!win) return;

          const cleanup = () => {
            try {
              if (document.body.contains(iframe)) {
                document.body.removeChild(iframe);
              }
              URL.revokeObjectURL(url);
            } catch (e) {
              console.warn("Print cleanup error:", e);
            }
          };

          // Use afterprint event to detect when print dialog is closed (printed or cancelled)
          win.addEventListener("afterprint", cleanup);

          win.print();
        };
      }
    }).catch((error) => {
      console.error("Print failed:", error);
      toast.error(t("app.export_fail"));
    });
  };

  const handleSaveDraft = async (silent = false) => {
    if (!state.pdfBytes) return;

    setState({ isSaving: true });

    try {
      await saveDraft({
        pdfBytes: state.pdfBytes,
        fields: state.fields,
        annotations: state.annotations,
        metadata: state.metadata,
        filename: state.filename,
      });
      setState({
        hasSavedSession: true,
        isDirty: false,
        lastSavedAt: new Date(),
      });
    } catch (error) {
      console.error("Save draft failed:", error);
      if (!silent) toast.error("Failed to save draft.");
    } finally {
      setState({ isSaving: false });
    }
  };

  const closeSession = async () => {
    pdfDisposeRef.current?.();
    pdfDisposeRef.current = null;

    resetDocument();
    navigate("/");
  };

  const onEditorSaveDraft = useCallback(
    (silent?: boolean) => {
      void handleSaveDraft(silent ?? false);
    },
    [handleSaveDraft],
  );

  const onEditorExit = useCallback(() => {
    void closeSession();
  }, [closeSession]);

  const onEditorPrint = useCallback(() => {
    void handlePrint();
  }, [handlePrint]);

  const onEditorAutoDetect = useCallback(() => {
    void handleAdvancedDetect({
      pageRange: "All",
      allowedTypes: [],
      extraPrompt: "",
      defaultStyle: DEFAULT_FIELD_STYLE,
      useCustomStyle: false,
    });
  }, [handleAdvancedDetect]);

  return (
    <div className="flex h-full w-full flex-col">
      <AppRoutes
        canAccessEditor={state.pages.length > 0}
        isLoading={state.isProcessing}
        landing={
          <LandingPage
            onUpload={handleUpload}
            onOpen={handleOpen}
            onOpenRecent={handleOpenRecent}
            hasSavedSession={state.hasSavedSession}
            onResume={handleResumeSession}
          />
        }
        editor={
          <EditorPage
            editorStore={state}
            onExport={handleExport}
            onSaveDraft={onEditorSaveDraft}
            onSaveAs={handleSaveAs}
            onExit={onEditorExit}
            onPrint={onEditorPrint}
            onAutoDetect={onEditorAutoDetect}
          />
        }
      />

      <KeyboardShortcutsHelp
        isOpen={state.activeDialog === "shortcuts"}
        onClose={() => setState((prev) => ({ ...prev, activeDialog: null }))}
      />
      <SettingsDialog
        isOpen={state.activeDialog === "settings"}
        onClose={() => setState((prev) => ({ ...prev, activeDialog: null }))}
        options={state.snappingOptions}
        onChange={(o) => setState((prev) => ({ ...prev, snappingOptions: o }))}
      />
      <AIDetectionDialog
        isOpen={state.activeDialog === "ai_detect"}
        onClose={() => setState((prev) => ({ ...prev, activeDialog: null }))}
        onConfirm={handleAdvancedDetect}
        totalPages={state.pages.length}
      />

      <Dialog
        open={fileDropDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setFileDropDialogOpen(false);
            setPendingFileDropPath(null);
          }
        }}
      >
        <DialogContent>
          <DialogTitle>{t("dialog.file_drop.title")}</DialogTitle>
          <DialogDescription>{t("dialog.file_drop.desc")}</DialogDescription>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setFileDropDialogOpen(false);
                setPendingFileDropPath(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            {state.isDirty && (
              <Button
                variant="secondary"
                onClick={async () => {
                  const path = pendingFileDropPath;
                  setFileDropDialogOpen(false);
                  setPendingFileDropPath(null);
                  if (!path) return;
                  if (isTauri()) {
                    const ok = await handleExport();
                    if (!ok) return;
                  } else {
                    await handleSaveDraft(true);
                  }
                  await openDroppedPdfPath(path);
                }}
                disabled={!pendingFileDropPath}
              >
                {isTauri()
                  ? t("dialog.file_drop.save_open")
                  : t("dialog.file_drop.save_draft_open")}
              </Button>
            )}
            <Button
              onClick={async () => {
                const path = pendingFileDropPath;
                setFileDropDialogOpen(false);
                setPendingFileDropPath(null);
                if (!path) return;
                await openDroppedPdfPath(path);
              }}
              disabled={!pendingFileDropPath}
            >
              {t("dialog.file_drop.open")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={state.isProcessing}>
        <DialogContent
          showCloseButton={false}
          className="flex flex-col items-center justify-center text-center sm:max-w-[300px]"
        >
          <DialogTitle className="sr-only">
            {t("common.processing")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("common.processing")}
          </DialogDescription>
          <div className="border-primary mb-4 h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"></div>
          <p className="text-foreground text-lg font-medium">
            {state.processingStatus || t("common.processing")}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default App;
