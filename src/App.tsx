import React, { useCallback, useState } from "react";
import KeyboardShortcutsHelp from "./components/KeyboardShortcutsHelp";
import SettingsDialog from "./components/dialogs/SettingsDialog";
import FileDropDialog from "./components/dialogs/FileDropDialog";
import PdfPasswordDialog from "./components/dialogs/PdfPasswordDialog";
import { EditorState } from "./types";
import { loadPDF, exportPDF } from "./services/pdfService";
import { getDraft } from "./services/storageService";
import { useLanguage } from "./components/language-provider";
import { toast } from "sonner";
import { useEditorStore } from "./store/useEditorStore";
import { useLocation } from "wouter";
import AppRoutes from "./AppRoutes";
import { useAppInitialization } from "./app/useAppInitialization";
import { recentFilesService } from "./services/recentFilesService";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useGlobalProcessingToast } from "./hooks/useGlobalProcessingToast";
import { useShallow } from "zustand/react/shallow";
import { selectAppShellState } from "@/store/selectors";
import {
  exportPdfBytes,
  getPlatformDocumentSaveMode,
  getSavedDraftViewState,
  getSavedViewStateForSaveTarget,
  hasSavedDraftSession,
  openFile,
  openFileFromPath,
  pickSaveTarget,
  persistPlatformDraftSession,
  saveEditorViewState,
  setSavedDraftSession,
  writeToSaveTarget,
  type SaveTarget,
} from "@/services/platform";

// App orchestrator (not just UI).
//
// This file coordinates the main user journeys:
// - Open/parse a PDF -> populate the editor store
// - Render landing/editor routes
// - Save/export via the unified `services/platform` APIs
// - Web draft persistence via `storageService`
// - AI field detection via `services/ai`
//
// Rule of thumb:
// - Rendering/interaction logic lives in `pages/EditorPage.tsx` and `components/workspace/Workspace.tsx`.
// - Authoritative editor state lives in `store/useEditorStore.ts`.
// - PDF import/export pipeline lives in `services/pdfService/index.ts`.

const App: React.FC = () => {
  const { t } = useLanguage();
  const platformDocumentSaveMode = getPlatformDocumentSaveMode();

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
  const state = useEditorStore(useShallow(selectAppShellState));
  const {
    setState,
    setOptions,
    resetDocument,
    withProcessing,
    loadDocument,
    isProcessing,
    processingStatus,
    pagesLength,
    hasSavedSession,
    activeDialog,
    options,
    isDirty,
  } = state;

  // Global "processing" UI.
  //
  // Any long-running operation should wrap itself with `withProcessing()` and update
  // `processingStatus` via `setProcessingStatus()`.
  //
  // We render this as a Sonner loading toast (instead of a blocking dialog) so:
  // - long tasks (load/export/AI) share one consistent UX
  // - UI remains usable while background work runs
  useGlobalProcessingToast({
    isProcessing,
    processingStatus,
    defaultMessage: t("common.processing"),
  });
  const pdfDisposeRef = React.useRef<null | (() => void)>(null);
  const loadQueueRef = React.useRef<Promise<void>>(Promise.resolve());

  const [fileDropDialogOpen, setFileDropDialogOpen] = useState(false);
  const [pendingFileDropPath, setPendingFileDropPath] = useState<string | null>(
    null,
  );

  const [pdfPasswordPrompt, setPdfPasswordPrompt] = useState<{
    id: string;
    reason: "need_password" | "incorrect_password";
    submit: (password: string) => void;
    cancel: () => void;
  } | null>(null);

  useAppEvent("pdf:passwordRequired", (payload) => {
    setPdfPasswordPrompt(payload);
  });

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
      // - Must cleanup previous embedded font faces (see `pdfDisposeRef`).
      // - Must reset store before loading, but preserve cross-document UI bits (e.g. `hasSavedSession`).
      // - All heavy work should be wrapped by `withProcessing()` so UI can display status/spinners.
      const run = async () => {
        recentFilesService.cancelPreviewTasks();
        const snapshot = useEditorStore.getState();
        saveEditorViewState({
          saveTarget: snapshot.saveTarget,
          pagesLength: snapshot.pages.length,
          scale: snapshot.scale,
          currentPageIndex: snapshot.currentPageIndex,
          scrollContainer: workspaceScrollContainerRef.current,
        });

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

          pdfDisposeRef.current?.();
          pdfDisposeRef.current = null;

          if (typeof requestAnimationFrame === "function") {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
          }

          const {
            pdfBytes,
            pages,
            fields,
            annotations,
            preservedSourceAnnotations,
            metadata,
            outline,
            openPassword,
            dispose,
          } = await loadPDF(options.input);
          pdfDisposeRef.current = dispose;

          loadDocument({
            pdfFile: options.pdfFile,
            pdfBytes,
            metadata,
            filename: options.filename,
            saveTarget: options.saveTarget,
            pages,
            fields,
            annotations,
            preservedSourceAnnotations,
            outline,
            scale: 1.0,
          });

          setState({
            pdfOpenPassword: openPassword ?? null,
            exportPassword: openPassword ?? null,
          });

          try {
            const persistedDraft = await persistPlatformDraftSession({
              pdfBytes,
              fields,
              annotations,
              metadata,
              filename: options.filename,
            });
            if (persistedDraft) {
              setState({
                hasSavedSession: true,
                lastSavedAt: new Date(),
                isDirty: false,
              });
            }
          } catch {
            // ignore
          }

          if (options.saveTarget?.kind === "tauri") {
            const tauriPath = options.saveTarget.path;
            recentFilesService.upsertWithBytesPreview({
              path: tauriPath,
              filename: options.filename,
              pdfBytes,
              targetWidth: 240,
            });

            const lastViewState = getSavedViewStateForSaveTarget(
              options.saveTarget,
            );
            if (lastViewState) {
              const restoredPageIndex =
                typeof lastViewState.pageIndex === "number"
                  ? Math.max(
                      0,
                      Math.min(
                        pages.length - 1,
                        Math.floor(lastViewState.pageIndex),
                      ),
                    )
                  : null;
              setState({
                pendingViewStateRestore: {
                  scale: lastViewState.scale,
                  scrollLeft: lastViewState.scrollLeft,
                  scrollTop: lastViewState.scrollTop,
                },
                ...(restoredPageIndex !== null
                  ? { currentPageIndex: restoredPageIndex }
                  : {}),
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
    [loadDocument, navigate, resetDocument, setState, t, withProcessing],
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
      setSavedDraftSession(false);
      setState({ hasSavedSession: false });
      return;
    }
    const viewState = getSavedDraftViewState();
    await withProcessing(t("app.loading_draft"), async () => {
      pdfDisposeRef.current?.();
      pdfDisposeRef.current = null;

      // Re-load the PDF document from bytes as it is not serializable in DB
      const {
        pages,
        annotations: fileAnnotations,
        preservedSourceAnnotations,
        outline,
        openPassword,
        dispose,
      } = await loadPDF(draft.pdfBytes);
      pdfDisposeRef.current = dispose;

      loadDocument({
        pdfFile: null,
        pdfBytes: draft.pdfBytes,
        pages,
        outline,
        fields: draft.fields,
        annotations: draft.annotations
          ? [
              ...draft.annotations.filter((a) => a.type !== "link"),
              ...fileAnnotations.filter((a) => a.type === "link"),
            ]
          : fileAnnotations,
        preservedSourceAnnotations,
        metadata: draft.metadata,
        filename: draft.filename,
        saveTarget: null,
        scale: viewState?.scale ?? 1.0,
      });

      setState({
        pdfOpenPassword: openPassword ?? null,
        exportPassword: openPassword ?? null,
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

  const generatePDF = useCallback(async () => {
    const snapshot = useEditorStore.getState();
    if (!snapshot.pdfBytes) return null;
    return await exportPDF(
      snapshot.pdfBytes,
      snapshot.fields,
      snapshot.metadata,
      snapshot.annotations,
      undefined,
      {
        openPassword: snapshot.pdfOpenPassword,
        exportPassword: snapshot.exportPassword,
        removeTextUnderFlattenedFreetext:
          snapshot.options.removeTextUnderFlattenedFreetext,
        preservedSourceAnnotations: snapshot.preservedSourceAnnotations,
      },
    );
  }, []);

  const handleSaveAs = useCallback(async (): Promise<boolean> => {
    const snapshot = useEditorStore.getState();
    if (!snapshot.pdfBytes) return false;
    return await withProcessing(t("app.generating"), async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const modifiedBytes = await generatePDF();
      if (!modifiedBytes) return false;

      const target = await pickSaveTarget({
        suggestedName: snapshot.filename || "document.pdf",
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });
      if (!target) return false;

      await writeToSaveTarget(target, modifiedBytes);

      const nextFilename = (() => {
        if (isTauriSaveTarget(target)) {
          const normalized = target.path.replace(/\\/g, "/");
          const parts = normalized.split("/").filter(Boolean);
          return parts.length > 0 ? parts[parts.length - 1] : snapshot.filename;
        }
        if (target?.kind === "web") {
          return target.handle?.name || snapshot.filename;
        }
        return snapshot.filename;
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
        const liveSnapshot = useEditorStore.getState();
        saveEditorViewState({
          saveTarget: target as EditorState["saveTarget"],
          pagesLength: liveSnapshot.pages.length,
          scale: liveSnapshot.scale,
          currentPageIndex: liveSnapshot.currentPageIndex,
          scrollContainer: workspaceScrollContainerRef.current,
        });
      }

      toast.success(t("app.save_success"));
      return true;
    }).catch((err) => {
      if (err?.name === "AbortError") return false;
      console.error("Save As failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${t("app.save_fail")}${msg ? `: ${msg}` : ""}`);
      return false;
    });
  }, [generatePDF, setState, t, withProcessing]);

  const handleExport = useCallback(async (): Promise<boolean> => {
    return await withProcessing(t("app.generating"), async () => {
      const snapshot = useEditorStore.getState();
      const modifiedBytes = await generatePDF();
      if (!modifiedBytes) return false;

      const result = await exportPdfBytes({
        bytes: modifiedBytes,
        filename: snapshot.filename || "document.pdf",
        existingTarget: snapshot.saveTarget,
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
            filename: snapshot.filename || "document.pdf",
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
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(`${t("app.export_fail")}${msg ? `: ${msg}` : ""}`);
      return false;
    });
  }, [generatePDF, setState, t, withProcessing]);

  const handlePrint = useCallback(async () => {
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
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(`${t("app.export_fail")}${msg ? `: ${msg}` : ""}`);
    });
  }, [generatePDF, t, withProcessing]);

  const handleSaveDraft = useCallback(
    async (silent = false) => {
      if (platformDocumentSaveMode !== "draft") return;

      const snapshot = useEditorStore.getState();
      if (!snapshot.pdfBytes) return;

      setState({ isSaving: true });

      try {
        await persistPlatformDraftSession({
          pdfBytes: snapshot.pdfBytes,
          fields: snapshot.fields,
          annotations: snapshot.annotations,
          metadata: snapshot.metadata,
          filename: snapshot.filename,
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
    },
    [platformDocumentSaveMode, setState],
  );

  const closeSession = useCallback(async () => {
    recentFilesService.cancelPreviewTasks();
    const snapshot = useEditorStore.getState();
    saveEditorViewState({
      saveTarget: snapshot.saveTarget,
      pagesLength: snapshot.pages.length,
      scale: snapshot.scale,
      currentPageIndex: snapshot.currentPageIndex,
      scrollContainer: workspaceScrollContainerRef.current,
    });

    pdfDisposeRef.current?.();
    pdfDisposeRef.current = null;

    const hasDraft = hasSavedDraftSession();

    resetDocument();
    setState({ hasSavedSession: hasDraft });
    navigate("/");
  }, [navigate, resetDocument, setState]);

  const saveCurrentDocumentBeforeOpen = useCallback(async () => {
    if (platformDocumentSaveMode === "draft") {
      await handleSaveDraft(true);
      return true;
    }
    return await handleExport();
  }, [handleExport, handleSaveDraft, platformDocumentSaveMode]);

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
        canAccessEditor={pagesLength > 0}
        isLoading={isProcessing}
        landingProps={{
          onUpload: handleUpload,
          onOpen: handleOpen,
          onOpenRecent: handleOpenRecent,
          hasSavedSession,
          onResume: handleResumeSession,
        }}
        editorProps={{
          onExport: handleExport,
          onSaveDraft: onEditorSaveDraft,
          onSaveAs: handleSaveAs,
          onExit: onEditorExit,
          onPrint: onEditorPrint,
        }}
      />

      <KeyboardShortcutsHelp
        isOpen={activeDialog === "shortcuts"}
        onClose={() => setState({ activeDialog: null })}
      />
      <SettingsDialog
        isOpen={activeDialog === "settings"}
        onClose={() => setState({ activeDialog: null })}
        options={options}
        onChange={(o) => setOptions(o)}
      />

      <FileDropDialog
        isOpen={fileDropDialogOpen}
        pendingPath={pendingFileDropPath}
        isDirty={isDirty}
        onClose={() => {
          setFileDropDialogOpen(false);
          setPendingFileDropPath(null);
        }}
        onSaveAndOpen={async () => {
          const path = pendingFileDropPath;
          setFileDropDialogOpen(false);
          setPendingFileDropPath(null);
          if (!path) return;
          const ok = await saveCurrentDocumentBeforeOpen();
          if (!ok) return;
          await openDroppedPdfPath(path);
        }}
        onOpen={async () => {
          const path = pendingFileDropPath;
          setFileDropDialogOpen(false);
          setPendingFileDropPath(null);
          if (!path) return;
          await openDroppedPdfPath(path);
        }}
      />

      <PdfPasswordDialog
        prompt={
          pdfPasswordPrompt
            ? { id: pdfPasswordPrompt.id, reason: pdfPasswordPrompt.reason }
            : null
        }
        onCancel={() => {
          const cur = pdfPasswordPrompt;
          setPdfPasswordPrompt(null);
          if (cur) cur.cancel();
        }}
        onSubmit={(password) => {
          const cur = pdfPasswordPrompt;
          setPdfPasswordPrompt(null);
          if (cur) cur.submit(password);
        }}
      />
    </div>
  );
};

export default App;
