import React, { useEffect, useCallback, useState } from "react";
import KeyboardShortcutsHelp from "./components/KeyboardShortcutsHelp";
import SettingsDialog from "./components/SettingsDialog";
import type { AIDetectionOptions } from "./components/AIDetectionOptionsForm";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "./components/ui/dialog";
import { Button } from "./components/ui/button";
import { EditorState, FormField } from "./types";
import { loadPDF, exportPDF, renderPage } from "./services/pdfService";
import { analyzePageForFields } from "./services/LLMService";
import { saveDraft, getDraft } from "./services/storageService";
import {
  exportPdfBytes,
  openFileFromPath,
  getStartupOpenPdfArg,
  openFile,
  pickSaveTarget,
  writeToSaveTarget,
  type SaveTarget,
} from "./services/fileOps";
import { useLanguage } from "./components/language-provider";
import { toast } from "sonner";
import { useEditorStore, type EditorActions } from "./store/useEditorStore";
import { useLocation } from "wouter";
import AppRoutes from "./AppRoutes";
import { useAppInitialization } from "./app/useAppInitialization";
import { Spinner } from "./components/ui/spinner";
import { recentFilesService } from "./services/recentFilesService";
import { isTauri } from "@tauri-apps/api/core";
import { useAppEvent } from "@/hooks/useAppEventBus";

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

const App: React.FC = () => {
  const { t } = useLanguage();

  const workspaceScrollContainerRef = React.useRef<HTMLElement | null>(null);

  useAppEvent(
    "workspace:scrollContainerReady",
    ({ element }) => {
      workspaceScrollContainerRef.current = element;
    },
    { replayLast: true },
  );

  const isTauriSaveTarget = (
    target: SaveTarget,
  ): target is { kind: "tauri"; path: string } => {
    return target?.kind === "tauri" && typeof target?.path === "string";
  };

  const [, navigate] = useLocation();

  // Use Zustand store
  const state = useEditorStore();
  const {
    setState,
    setOptions,
    getPageCached,
    saveCheckpoint,
    resetDocument,
    setProcessingStatus,
    withProcessing,
    loadDocument,
  } = state;
  const pdfDisposeRef = React.useRef<null | (() => void)>(null);
  const loadQueueRef = React.useRef<Promise<void>>(Promise.resolve());

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
        recentFilesService.cancelPreviewTasks();
        const prevPdfDocument = useEditorStore.getState().pdfDocument;

        if (isTauri() && typeof document !== "undefined") {
          const snapshot = useEditorStore.getState();
          const tauriPath =
            snapshot.saveTarget?.kind === "tauri"
              ? snapshot.saveTarget.path
              : null;
          if (tauriPath) {
            const el = workspaceScrollContainerRef.current;
            if (el) {
              recentFilesService.saveTauriViewState({
                path: tauriPath,
                scale: snapshot.scale,
                pageIndex: snapshot.currentPageIndex,
                element: el,
              });
            }
          }
        }

        resetDocument();

        await withProcessing(t("app.parsing"), async () => {
          if (typeof requestAnimationFrame === "function") {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
          }

          await Promise.race([
            recentFilesService.waitForPreviewQueue().catch(() => {
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

          // Web: overwrite any previous draft immediately so the latest opened file
          // becomes the resumable session (even before the user makes edits).
          if (!isTauri()) {
            try {
              await saveDraft({
                pdfBytes,
                fields,
                annotations,
                metadata,
                filename: options.filename,
              });
              recentFilesService.setWebSession(true);
              setState({
                hasSavedSession: true,
                lastSavedAt: new Date(),
                isDirty: false,
              });
            } catch {
              // ignore
            }
          }

          if (options.saveTarget?.kind === "tauri") {
            const tauriPath = options.saveTarget.path;
            recentFilesService.upsertWithDocPreview({
              path: tauriPath,
              filename: options.filename,
              pdfDocument,
              targetWidth: 240,
            });

            const lastViewState = recentFilesService.getViewState(tauriPath);
            if (lastViewState) {
              setState({
                pendingViewStateRestore: {
                  scale: lastViewState.scale,
                  scrollLeft: lastViewState.scrollLeft,
                  scrollTop: lastViewState.scrollTop,
                },
              });
            }
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
    if (!draft) {
      recentFilesService.setWebSession(false);
      setState({ hasSavedSession: false });
      return;
    }
    const viewState = recentFilesService.getWebDraftView();
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
        scale: viewState?.scale ?? 1.0,
      });

      if (viewState) {
        setState({
          pendingViewStateRestore: {
            scale: viewState.scale,
            scrollLeft: viewState.scrollLeft,
            scrollTop: viewState.scrollTop,
          },
        });
      }

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

      const nextFilename = (() => {
        if (isTauriSaveTarget(target)) {
          const normalized = target.path.replace(/\\/g, "/");
          const parts = normalized.split("/").filter(Boolean);
          return parts.length > 0 ? parts[parts.length - 1] : state.filename;
        }
        if (target?.kind === "web") {
          return target.handle?.name || state.filename;
        }
        return state.filename;
      })();

      setState({
        saveTarget: target as unknown as EditorState["saveTarget"],
        filename: nextFilename,
        lastSavedAt: new Date(),
        isDirty: false,
      });

      if (isTauriSaveTarget(target)) {
        const tauriTarget = target;
        recentFilesService.upsertWithBytesPreview({
          path: tauriTarget.path,
          filename: nextFilename || "document.pdf",
          pdfBytes: modifiedBytes,
          targetWidth: 240,
          renderAnnotations: true,
          forcePreviewRender: true,
        });

        if (typeof document !== "undefined") {
          const snapshot = useEditorStore.getState();
          const el = workspaceScrollContainerRef.current;
          if (el) {
            recentFilesService.saveTauriViewState({
              path: tauriTarget.path,
              scale: snapshot.scale,
              pageIndex: snapshot.currentPageIndex,
              element: el,
            });
          }
        }
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
          recentFilesService.upsertWithBytesPreview({
            path: savedTarget.path,
            filename: state.filename || "document.pdf",
            pdfBytes: modifiedBytes,
            targetWidth: 240,
            renderAnnotations: true,
            forcePreviewRender: true,
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
    const snapshot = useEditorStore.getState();
    if (!snapshot.pdfBytes) return;

    setState({ isSaving: true });

    try {
      await saveDraft({
        pdfBytes: snapshot.pdfBytes,
        fields: snapshot.fields,
        annotations: snapshot.annotations,
        metadata: snapshot.metadata,
        filename: snapshot.filename,
      });
      recentFilesService.setWebSession(true);
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
    recentFilesService.cancelPreviewTasks();
    if (isTauri()) {
      const snapshot = useEditorStore.getState();
      const tauriPath =
        snapshot.saveTarget?.kind === "tauri" ? snapshot.saveTarget.path : null;

      if (tauriPath) {
        const el = workspaceScrollContainerRef.current;
        if (el) {
          recentFilesService.saveTauriViewState({
            path: tauriPath,
            scale: snapshot.scale,
            pageIndex: snapshot.currentPageIndex,
            element: el,
          });
        }
      }
    }

    if (!isTauri() && typeof document !== "undefined") {
      const snapshot = useEditorStore.getState();
      if (snapshot.pages.length > 0) {
        const el = workspaceScrollContainerRef.current;
        if (el) {
          recentFilesService.saveWebDraftView({
            scale: snapshot.scale,
            element: el,
          });
        }
      }
    }

    pdfDisposeRef.current?.();
    pdfDisposeRef.current = null;

    const hasDraft = !isTauri() ? recentFilesService.hasWebSession() : false;

    resetDocument();
    if (!isTauri()) {
      setState({ hasSavedSession: hasDraft });
    }
    navigate("/");
  };

  const onEditorSaveDraft = useCallback(
    async (silent?: boolean) => {
      await handleSaveDraft(silent ?? false);
    },
    [handleSaveDraft],
  );

  const onEditorExit = useCallback(() => {
    void closeSession();
  }, [closeSession]);

  const onEditorPrint = useCallback(() => {
    void handlePrint();
  }, [handlePrint]);

  return (
    <div className="flex h-full w-full flex-col">
      <AppRoutes
        canAccessEditor={state.pages.length > 0}
        isLoading={state.isProcessing}
        landingProps={{
          onUpload: handleUpload,
          onOpen: handleOpen,
          onOpenRecent: handleOpenRecent,
          hasSavedSession: state.hasSavedSession,
          onResume: handleResumeSession,
        }}
        editorProps={{
          editorStore: state,
          onExport: handleExport,
          onSaveDraft: onEditorSaveDraft,
          onSaveAs: handleSaveAs,
          onExit: onEditorExit,
          onPrint: onEditorPrint,
          onAdvancedDetect: handleAdvancedDetect,
        }}
      />

      <KeyboardShortcutsHelp
        isOpen={state.activeDialog === "shortcuts"}
        onClose={() => setState((prev) => ({ ...prev, activeDialog: null }))}
      />
      <SettingsDialog
        isOpen={state.activeDialog === "settings"}
        onClose={() => setState((prev) => ({ ...prev, activeDialog: null }))}
        options={state.options}
        onChange={(o) => setOptions(o)}
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
          <Spinner size="lg" className="text-primary mb-4" />
          <p className="text-foreground text-lg font-medium">
            {state.processingStatus || t("common.processing")}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default App;
