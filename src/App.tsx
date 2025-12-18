import React, { useEffect, useCallback } from "react";
import Toolbar from "./components/toolbar/Toolbar";
import Workspace from "./components/workspace/Workspace";
import { PropertiesPanel } from "./components/properties-panel/PropertiesPanel";
import LandingPage from "./components/LandingPage";
import ZoomControls from "./components/toolbar/ZoomControls";
import KeyboardShortcutsHelp from "./components/KeyboardShortcutsHelp";
import SettingsDialog from "./components/SettingsDialog";
import AIDetectionDialog, {
  AIDetectionOptions,
} from "./components/AIDetectionDialog";
import Sidebar from "./components/sidebar/Sidebar";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "./components/ui/dialog";
import { Button } from "./components/ui/button";
import {
  EditorState,
  FormField,
  PageData,
  Annotation,
  PDFMetadata,
} from "./types";
import { loadPDF, exportPDF, renderPage } from "./services/pdfService";
import { analyzePageForFields } from "./services/geminiService";
import { saveDraft, getDraft, clearDraft } from "./services/storageService";
import { DEFAULT_FIELD_STYLE, ANNOTATION_STYLES } from "./constants";
import { useLanguage } from "./components/language-provider";
import { toast } from "sonner";
import { useEditorStore } from "./store/useEditorStore";

const App: React.FC = () => {
  const { t } = useLanguage();

  // Use Zustand store
  const state = useEditorStore();
  const {
    setState,
    getPageCached,
    addField,
    addAnnotation,
    updateField,
    updateAnnotation,
    deleteSelection,
    selectControl,
    setTool,
    saveCheckpoint,
    undo,
    redo,
    deleteAnnotation,
  } = state;
  const isClosingRef = React.useRef(false);
  const pdfDisposeRef = React.useRef<null | (() => void)>(null);

  // Refs for stable access in event listeners
  const handlersRef = React.useRef<{
    handleSaveDraft: (manual?: boolean) => Promise<void>;
    handlePrint: () => void;
  } | null>(null);

  useEffect(() => {
    getDraft().then((draft) => {
      if (draft) setState({ hasSavedSession: true });
    });
  }, [setState]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state.isDirty && !isClosingRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [state.isDirty]);

  useEffect(() => {
    return () => {
      pdfDisposeRef.current?.();
      pdfDisposeRef.current = null;
    };
  }, []);

  const handleEditAnnotation = useCallback((id: string) => {
    setState({ isSidebarOpen: true, sidebarTab: "annotations" });

    selectControl(id);

    // Try to focus the textarea in the sidebar
    requestAnimationFrame(() => {
      // We need a way to identify the textarea in the sidebar.
      // Let's assume we'll add an ID to the textarea in CommentsPanel
      const el = document.getElementById(
        `annotation-input-${id}`,
      ) as HTMLTextAreaElement;
      if (el) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    });
  }, []);

  useEffect(() => {
    if (state.pages.length > 0 && state.pdfBytes) {
      const timer = setTimeout(() => {
        handleSaveDraft(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [state.fields, state.annotations, state.metadata, state.filename]);

  const calculateFitScale = useCallback(
    (pagesList: PageData[], pageIndex: number = 0) => {
      if (!pagesList || pagesList.length === 0) return 1.0;
      // Ensure pageIndex is within bounds
      const targetIndex = Math.max(
        0,
        Math.min(pageIndex, pagesList.length - 1),
      );
      const page = pagesList[targetIndex];
      if (!page.width) return 1.0;
      const SIDEBAR_WIDTH = state.isSidebarOpen ? state.sidebarWidth : 0;
      const PANEL_WIDTH =
        !state.isPanelFloating && state.isRightPanelOpen
          ? state.rightPanelWidth
          : 0;
      const PADDING = 96;
      const availableWidth =
        window.innerWidth - SIDEBAR_WIDTH - PANEL_WIDTH - PADDING;
      const scale = availableWidth / page.width;
      return Math.max(0.25, Math.min(5.0, Number(scale.toFixed(2))));
    },
    [
      state.isSidebarOpen,
      state.isPanelFloating,
      state.isRightPanelOpen,
      state.sidebarWidth,
      state.rightPanelWidth,
    ],
  );

  const updateScale = (newScale: number) => {
    const clamped = Math.max(0.25, Math.min(5.0, newScale));
    setState({ scale: clamped });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Access latest state directly from store without needing refs
      const currentState = useEditorStore.getState();

      // Update Modifier Keys
      if (
        e.key === "Control" ||
        e.key === "Shift" ||
        e.key === "Alt" ||
        e.key === "Meta"
      ) {
        currentState.setKeys({
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey,
          space: currentState.keys.space,
        });
        return;
      }

      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (e.key === " " && !isInput) {
        e.preventDefault();
        e.stopPropagation();
        if (!currentState.keys.space) {
          currentState.setKeys({ space: true });
        }
        return;
      }

      // Handle Escape Key
      if (e.key === "Escape") {
        if (currentState.activeDialog) {
          return;
        }

        if (isInput) target.blur();

        // Escape Action Logic
        if (currentState.selectedId) {
          currentState.selectControl(null);
        } else if (currentState.tool !== "select") {
          currentState.setTool("select");
        }
        return;
      }

      // Handle Ctrl+S (Save)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handlersRef.current?.handleSaveDraft(false);
        return;
      }

      // Handle Ctrl+P (Print)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        handlersRef.current?.handlePrint();
        return;
      }

      // Handle Delete/Backspace
      if (e.key === "Delete" || e.key === "Backspace") {
        if (isInput && !(target as HTMLInputElement).readOnly) {
          return;
        }
        const isSelectedField = currentState.fields.some(
          (f) => f.id === currentState.selectedId,
        );
        if (currentState.mode === "annotation" && isSelectedField) {
          return;
        }
        currentState.deleteSelection();
        return;
      }

      // Block other shortcuts if typing in a writable input
      if (isInput && !(target as HTMLInputElement).readOnly) {
        return;
      }

      // Handle Arrow Keys
      if (
        currentState.mode === "form" &&
        currentState.selectedId &&
        currentState.fields.some((f) => f.id === currentState.selectedId) &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
      ) {
        e.preventDefault();
        const isFast = e.shiftKey;
        let direction: "UP" | "DOWN" | "LEFT" | "RIGHT" = "UP";
        if (e.key === "ArrowUp") direction = "UP";
        else if (e.key === "ArrowDown") direction = "DOWN";
        else if (e.key === "ArrowLeft") direction = "LEFT";
        else if (e.key === "ArrowRight") direction = "RIGHT";

        currentState.moveField(direction, isFast);
        return;
      }

      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (e.shiftKey) currentState.redo();
        else currentState.undo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        currentState.redo();
        return;
      }

      // Help Dialog
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        currentState.openDialog("shortcuts");
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const currentState = useEditorStore.getState();

      if (
        e.key === "Control" ||
        e.key === "Shift" ||
        e.key === "Alt" ||
        e.key === "Meta"
      ) {
        currentState.setKeys({
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey,
          space: currentState.keys.space,
        });
      }

      if (e.key === " ") {
        currentState.setKeys({ space: false });
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, []);

  const handleUpload = async (file: File) => {
    setState((prev) => ({ ...prev, isProcessing: true }));
    setState({ processingStatus: t("app.parsing") });
    try {
      pdfDisposeRef.current?.();
      pdfDisposeRef.current = null;

      const {
        pdfBytes,
        pdfDocument,
        pages,
        fields,
        annotations,
        metadata,
        outline,
        dispose,
      } = await loadPDF(file);
      pdfDisposeRef.current = dispose;
      const fitScale = calculateFitScale(pages);
      setState((prev) => ({
        ...prev,
        pdfFile: file,
        pdfBytes,
        pdfDocument,
        metadata,
        filename: file.name,
        pages,
        fields: fields,
        annotations: annotations,
        outline: outline,
        scale: fitScale,
        past: [],
        future: [],
        isProcessing: false,
      }));
      setState({ isDirty: false });
    } catch (error) {
      console.error("Error loading PDF:", error);
      toast.error(t("app.load_error"));
      setState((prev) => ({ ...prev, isProcessing: false }));
    } finally {
      setState({ processingStatus: null });
    }
  };

  const handleResumeSession = async () => {
    const draft = await getDraft();
    if (!draft) return;
    setState((prev) => ({ ...prev, isProcessing: true }));
    setState({ processingStatus: t("app.loading_draft") });
    try {
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
      const fitScale = calculateFitScale(pages);
      setState((prev) => ({
        ...prev,
        pdfFile: null,
        pdfBytes: draft.pdfBytes,
        pdfDocument,
        pages,
        outline,
        fields: draft.fields,
        annotations: draft.annotations || fileAnnotations, // Recover annotations from PDF bytes or draft
        metadata: draft.metadata,
        filename: draft.filename,
        scale: fitScale,
        past: [],
        future: [],
        isProcessing: false,
      }));
      setState({ isDirty: false });
    } catch (error) {
      console.error("Failed to resume session:", error);
      toast.error(t("app.load_error"));
      setState((prev) => ({ ...prev, isProcessing: false }));
    } finally {
      setState({ processingStatus: null });
    }
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

    setState((prev) => ({ ...prev, isProcessing: true }));
    let allNewFields: FormField[] = [];

    try {
      for (let i = 0; i < targetPageIndices.length; i++) {
        const pageIndex = targetPageIndices[i];
        const page = state.pages[pageIndex];

        setState({
          processingStatus: t("app.analyzing", {
            current: i + 1,
            total: targetPageIndices.length,
          }),
        });

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
          isProcessing: false,
          isDirty: true,
        }));
      } else {
        toast.info(t("app.no_new_fields"));
        setState((prev) => ({ ...prev, isProcessing: false }));
      }
    } catch (e) {
      console.error(e);
      setState((prev) => ({ ...prev, isProcessing: false }));
      toast.error(t("app.auto_detect_fail", { error: e.message }));
    } finally {
      setState({ processingStatus: null });
    }
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

    // Strictly use File System Access API
    if ("showSaveFilePicker" in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: state.filename || "document.pdf",
          types: [
            {
              description: "PDF Document",
              accept: { "application/pdf": [".pdf"] },
            },
          ],
        });

        // User selected a file, NOW generate the PDF
        setState((prev) => ({ ...prev, isProcessing: true }));
        setState({ processingStatus: t("app.generating") });

        try {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const modifiedBytes = await generatePDF();

          if (modifiedBytes) {
            const writable = await handle.createWritable();
            await writable.write(modifiedBytes);
            await writable.close();
            toast.success(t("app.save_success"));
            return true;
          }
        } finally {
          setState((prev) => ({ ...prev, isProcessing: false }));
          setState({ processingStatus: null });
        }
        return false;
      } catch (err: any) {
        if (err.name === "AbortError") {
          // User cancelled selection. Stop here.
          return false;
        }
        console.error("Save As failed:", err);
        toast.error(t("app.save_fail"));
        return false;
      }
    }

    return false;
  };

  const handleExport = async (): Promise<boolean> => {
    setState((prev) => ({ ...prev, isProcessing: true }));
    setState({ processingStatus: t("app.generating") });
    try {
      const modifiedBytes = await generatePDF();
      if (modifiedBytes) {
        const blob = new Blob([new Uint8Array(modifiedBytes)], {
          type: "application/pdf",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = state.filename || "document.pdf";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return true;
      }
    } catch (error) {
      console.error("Export failed:", error);
      toast.error(t("app.export_fail"));
      return false;
    } finally {
      setState((prev) => ({ ...prev, isProcessing: false }));
      setState({ processingStatus: null });
    }
    return false;
  };

  const handlePrint = async () => {
    setState((prev) => ({ ...prev, isProcessing: true }));
    setState({ processingStatus: t("app.generating") });
    try {
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
    } catch (error) {
      console.error("Print failed:", error);
      toast.error(t("app.export_fail"));
    } finally {
      setState((prev) => ({ ...prev, isProcessing: false }));
      setState({ processingStatus: null });
    }
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

  useEffect(() => {
    handlersRef.current = {
      handleSaveDraft,
      handlePrint,
    };
  }, [handleSaveDraft, handlePrint]);

  const closeSession = async () => {
    isClosingRef.current = true;
    await clearDraft();
    window.location.reload();
  };

  const handleCloseRequest = () => {
    setState((prev) => ({ ...prev, activeDialog: "close_confirm" }));
  };

  const selectedField =
    state.selectedId && state.fields.find((f) => f.id === state.selectedId)
      ? state.fields.find((f) => f.id === state.selectedId) || null
      : null;

  const selectedAnnotation =
    state.selectedId && state.annotations.find((a) => a.id === state.selectedId)
      ? state.annotations.find((a) => a.id === state.selectedId) || null
      : null;

  const selectedControl = selectedField || selectedAnnotation;

  const handlePenStyleChange = useCallback(
    (style: Partial<EditorState["penStyle"]>) => {
      setState((prev) => ({
        ...prev,
        penStyle: { ...prev.penStyle, ...style },
      }));
    },
    [],
  );

  const handleHighlightStyleChange = useCallback(
    (style: Partial<EditorState["penStyle"]>) => {
      setState((prev) => ({
        ...prev,
        highlightStyle: {
          ...(prev.highlightStyle || {
            color: ANNOTATION_STYLES.highlight.color,
            thickness: ANNOTATION_STYLES.highlight.thickness,
            opacity: ANNOTATION_STYLES.highlight.opacity,
          }),
          ...style,
        },
      }));
    },
    [],
  );

  const handleCommentStyleChange = useCallback((style: { color: string }) => {
    setState((prev) => ({
      ...prev,
      commentStyle: { ...prev.commentStyle, ...style },
    }));
  }, []);

  const handleFreetextStyleChange = useCallback((style: { color: string }) => {
    setState((prev) => ({
      ...prev,
      freetextStyle: { ...prev.freetextStyle!, ...style },
    }));
  }, []);

  const handlePropertiesChange = useCallback(
    (updates: Partial<FormField | Annotation>) => {
      const currentState = useEditorStore.getState();
      const currentSelectedId = currentState.selectedId;
      if (!currentSelectedId) return;

      const isField = currentState.fields.some(
        (f) => f.id === currentSelectedId,
      );
      if (isField) {
        currentState.updateField(
          currentSelectedId,
          updates as Partial<FormField>,
        );
      } else {
        const isAnnotation = currentState.annotations.some(
          (a) => a.id === currentSelectedId,
        );
        if (isAnnotation) {
          currentState.updateAnnotation(
            currentSelectedId,
            updates as Partial<Annotation>,
          );
        }
      }
    },
    [],
  );

  const handleMetadataChange = useCallback(
    (updates: Partial<PDFMetadata>) => {
      setState((prev) => ({
        ...prev,
        metadata: { ...prev.metadata, ...updates },
        isDirty: true,
      }));
    },
    [setState],
  );

  const handleFilenameChange = useCallback(
    (name: string) => {
      setState((prev) => ({ ...prev, filename: name, isDirty: true }));
    },
    [setState],
  );

  const handleToggleFloating = useCallback(() => {
    setState((prev) => ({ isPanelFloating: !prev.isPanelFloating }));
  }, [setState]);

  return (
    <div className="flex h-full w-full flex-col">
      {state.pages.length === 0 ? (
        <LandingPage
          onUpload={handleUpload}
          hasSavedSession={state.hasSavedSession}
          onResume={handleResumeSession}
        />
      ) : (
        <>
          <Toolbar
            editorState={state}
            isSaving={state.isSaving}
            isDirty={state.isDirty}
            onToolChange={(tool) => setTool(tool)}
            onModeChange={(mode) => setState({ mode, tool: "select" })}
            onPenStyleChange={handlePenStyleChange}
            onHighlightStyleChange={handleHighlightStyleChange}
            onCommentStyleChange={handleCommentStyleChange}
            onFreetextStyleChange={handleFreetextStyleChange}
            onExport={handleExport}
            onSaveDraft={() => handleSaveDraft(false)}
            onSaveAs={handleSaveAs}
            onExit={closeSession}
            onClose={handleCloseRequest}
            onPrint={handlePrint}
            onAutoDetect={() =>
              handleAdvancedDetect({
                pageRange: "All",
                allowedTypes: [],
                extraPrompt: "",
                defaultStyle: DEFAULT_FIELD_STYLE,
                useCustomStyle: false,
              })
            }
            onCustomAutoDetect={() =>
              setState((prev) => ({ ...prev, activeDialog: "ai_detect" }))
            }
            onUndo={undo}
            onRedo={redo}
            canUndo={state.past.length > 0}
            canRedo={state.future.length > 0}
            onOpenShortcuts={() =>
              setState((prev) => ({ ...prev, activeDialog: "shortcuts" }))
            }
            isFieldListOpen={state.isSidebarOpen}
            onToggleFieldList={() =>
              setState({ isSidebarOpen: !state.isSidebarOpen })
            }
            isPropertiesPanelOpen={state.isRightPanelOpen}
            onTogglePropertiesPanel={() =>
              setState({ isRightPanelOpen: !state.isRightPanelOpen })
            }
            onOpenSettings={() =>
              setState((prev) => ({ ...prev, activeDialog: "settings" }))
            }
          />

          <div className="relative flex flex-1 overflow-hidden">
            <Sidebar
              isOpen={state.isSidebarOpen}
              onClose={() => setState({ isSidebarOpen: false })}
              pages={state.pages}
              fields={state.fields}
              annotations={state.annotations}
              outline={state.outline}
              selectedId={state.selectedId}
              onSelectControl={(id) => {
                selectControl(id);
                if (id) {
                  setTimeout(() => {
                    let el = document.getElementById(`field-element-${id}`);
                    if (!el) {
                      el = document.getElementById(`annotation-${id}`);
                    }
                    if (el) {
                      el.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                        inline: "center",
                      });
                      // Try to find an input/textarea/select to focus
                      const input = el.querySelector(
                        "input, textarea, select",
                      ) as HTMLElement;
                      if (input) {
                        input.focus({ preventScroll: true });
                      }
                    }
                  }, 50);
                }
              }}
              onDeleteAnnotation={deleteAnnotation}
              onUpdateAnnotation={updateAnnotation}
              onNavigatePage={(idx) => {
                document
                  .getElementById(`page-${idx}`)
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
              currentPageIndex={state.currentPageIndex}
              width={state.sidebarWidth}
              onResize={(w) => setState({ sidebarWidth: w })}
              pdfDocument={state.pdfDocument}
              activeTab={state.sidebarTab}
              onTabChange={(tab) => setState({ sidebarTab: tab })}
            />

            <div className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden">
              <Workspace
                editorState={state}
                onAddField={addField}
                onAddAnnotation={addAnnotation}
                onSelectControl={selectControl}
                onUpdateField={updateField}
                onUpdateAnnotation={updateAnnotation}
                onDeleteAnnotation={deleteAnnotation}
                onEditAnnotation={handleEditAnnotation}
                onScaleChange={updateScale}
                onTriggerHistorySave={saveCheckpoint}
                onPageIndexChange={(idx) => setState({ currentPageIndex: idx })}
                onToolChange={(tool) => setTool(tool)}
                fitTrigger={state.fitTrigger}
              />
              <ZoomControls
                scale={state.scale}
                onZoomIn={() => updateScale(state.scale * 1.25)}
                onZoomOut={() => updateScale(state.scale / 1.25)}
                onReset={() => {
                  updateScale(
                    calculateFitScale(state.pages, state.currentPageIndex),
                  );
                  setState({ fitTrigger: Date.now() });
                }}
              />
            </div>

            {(state.mode === "form" ||
              state.mode === "annotation" ||
              selectedControl) &&
              state.isRightPanelOpen && (
                <PropertiesPanel
                  selectedControl={selectedControl}
                  metadata={state.metadata}
                  filename={state.filename}
                  onChange={handlePropertiesChange}
                  onMetadataChange={handleMetadataChange}
                  onFilenameChange={handleFilenameChange}
                  onDelete={deleteSelection}
                  onClose={() => selectControl(null)}
                  isFloating={state.isPanelFloating}
                  onToggleFloating={handleToggleFloating}
                  onTriggerHistorySave={saveCheckpoint}
                  width={state.rightPanelWidth}
                  onResize={(w) => setState({ rightPanelWidth: w })}
                />
              )}
          </div>
        </>
      )}

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
        open={state.activeDialog === "close_confirm"}
        onOpenChange={(open) => {
          if (!open) setState((prev) => ({ ...prev, activeDialog: null }));
        }}
      >
        <DialogContent>
          <DialogTitle>{t("dialog.confirm_close.title")}</DialogTitle>
          <DialogDescription>
            {t("dialog.confirm_close.desc")}
          </DialogDescription>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setState((prev) => ({ ...prev, activeDialog: null }))
              }
            >
              {t("dialog.confirm_close.cancel")}
            </Button>
            <Button variant="destructive" onClick={closeSession}>
              {t("dialog.confirm_close.confirm")}
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
