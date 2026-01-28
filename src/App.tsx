import React, { useCallback, useState } from "react";
import KeyboardShortcutsHelp from "./components/KeyboardShortcutsHelp";
import SettingsDialog from "./components/dialogs/SettingsDialog";
import type { AIDetectionOptions } from "./components/AIDetectionOptionsForm";
import FileDropDialog from "./components/dialogs/FileDropDialog";
import PdfPasswordDialog from "./components/dialogs/PdfPasswordDialog";
import { EditorState, FormField } from "./types";
import { loadPDF, exportPDF, renderPage } from "./services/pdfService";
import { analyzePageForFields } from "./services/LLMService";
import { saveDraft, getDraft } from "./services/storageService";
import {
  exportPdfBytes,
  openFileFromPath,
  openFile,
  pickSaveTarget,
  writeToSaveTarget,
  type SaveTarget,
} from "./services/fileOps";
import { useLanguage } from "./components/language-provider";
import { toast } from "sonner";
import { useEditorStore } from "./store/useEditorStore";
import { useLocation } from "wouter";
import AppRoutes from "./AppRoutes";
import { useAppInitialization } from "./app/useAppInitialization";
import { recentFilesService } from "./services/recentFilesService";
import { isTauri } from "@tauri-apps/api/core";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useGlobalProcessingToast } from "./hooks/useGlobalProcessingToast";

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
// - PDF import/export pipeline lives in `services/pdfService/index.ts`.

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
    saveCheckpoint,
    resetDocument,
    setProcessingStatus,
    withProcessing,
    loadDocument,
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
    isProcessing: state.isProcessing,
    processingStatus: state.processingStatus,
    defaultMessage: t("common.processing"),
  });
  const pdfDisposeRef = React.useRef<null | (() => void)>(null);
  const loadQueueRef = React.useRef<Promise<void>>(Promise.resolve());

  const [fileDropDialogOpen, setFileDropDialogOpen] = useState(false);
  const [pendingFileDropPath, setPendingFileDropPath] = useState<string | null>(
    null,
  );

  const [pdfLoadProgress, setPdfLoadProgress] = useState<{
    id: string;
    label?: string;
    loaded: number;
    total?: number;
  } | null>(null);

  const [pdfPasswordPrompt, setPdfPasswordPrompt] = useState<{
    id: string;
    reason: "need_password" | "incorrect_password";
    submit: (password: string) => void;
    cancel: () => void;
  } | null>(null);

  useAppEvent("pdf:loadStart", ({ id, label }) => {
    setPdfLoadProgress({ id, label, loaded: 0, total: undefined });
  });

  useAppEvent("pdf:loadProgress", ({ id, loaded, total }) => {
    setPdfLoadProgress((prev) => {
      if (!prev || prev.id !== id) return prev;
      return { ...prev, loaded, total };
    });
  });

  useAppEvent("pdf:loadEnd", ({ id }) => {
    setPdfLoadProgress((prev) => {
      if (!prev || prev.id !== id) return prev;
      return null;
    });
  });

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
                scrollLeft: el.scrollLeft,
                scrollTop: el.scrollTop,
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
            outline,
            scale: 1.0,
          });

          setState({
            pdfOpenPassword: openPassword ?? null,
            exportPassword: openPassword ?? null,
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
            recentFilesService.upsertWithBytesPreview({
              path: tauriPath,
              filename: options.filename,
              pdfBytes,
              targetWidth: 240,
            });

            const lastViewState = recentFilesService.getViewState(tauriPath);
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
        pages,
        annotations: fileAnnotations,
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

  const handleAdvancedDetect = async (options: AIDetectionOptions) => {
    if (state.pages.length === 0 || !state.pdfBytes) return;

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

        const base64Image = await renderPage({
          pageIndex,
          pdfBytes: state.pdfBytes,
          password: state.pdfOpenPassword,
        });

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
              providerId: options.providerId,
              modelId: options.modelId,
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
      undefined,
      {
        openPassword: state.pdfOpenPassword,
        exportPassword: state.exportPassword,
      },
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
              scrollLeft: 0,
              scrollTop: 0,
            });
          }
        }
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
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(`${t("app.export_fail")}${msg ? `: ${msg}` : ""}`);
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
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(`${t("app.export_fail")}${msg ? `: ${msg}` : ""}`);
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
            scrollLeft: el.scrollLeft,
            scrollTop: el.scrollTop,
          });
        }
      }
    }

    if (!isTauri() && typeof document !== "undefined") {
      const snapshot = useEditorStore.getState();
      if (snapshot.pages.length > 0) {
        const el = workspaceScrollContainerRef.current;
        if (el) {
          recentFilesService.saveWebDraftViewState({
            scale: snapshot.scale,
            scrollLeft: el.scrollLeft,
            scrollTop: el.scrollTop,
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
      {pdfLoadProgress && (
        <div className="bg-muted/70 sticky top-0 z-50 w-full border-b px-4 py-2 backdrop-blur">
          <div className="text-muted-foreground mb-1 text-xs">
            {(() => {
              const total = pdfLoadProgress.total;
              const loaded = pdfLoadProgress.loaded;
              if (typeof total === "number" && total > 0) {
                const pct = Math.max(
                  0,
                  Math.min(100, Math.round((loaded / total) * 100)),
                );
                return `${t("common.loading")} ${pct}%`;
              }
              return `${t("common.loading")} ${Math.max(0, loaded)} bytes`;
            })()}
          </div>
          <div className="bg-muted h-2 w-full rounded">
            <div
              className="bg-primary h-2 rounded"
              style={{
                width:
                  typeof pdfLoadProgress.total === "number" &&
                  pdfLoadProgress.total > 0
                    ? `${Math.max(
                        0,
                        Math.min(
                          100,
                          (pdfLoadProgress.loaded / pdfLoadProgress.total) *
                            100,
                        ),
                      )}%`
                    : "25%",
              }}
            />
          </div>
        </div>
      )}

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

      <FileDropDialog
        isOpen={fileDropDialogOpen}
        pendingPath={pendingFileDropPath}
        isDirty={state.isDirty}
        onClose={() => {
          setFileDropDialogOpen(false);
          setPendingFileDropPath(null);
        }}
        onSaveAndOpen={async () => {
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
