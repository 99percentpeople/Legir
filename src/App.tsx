import React, { useState, useEffect, useCallback } from "react";
import Toolbar from "./components/toolbar/Toolbar";
import Workspace from "./components/workspace/Workspace";
import { PropertiesPanel } from "./components/PropertiesPanel";
import LandingPage from "./components/LandingPage";
import ZoomControls from "./components/workspace/ZoomControls";
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
  HistorySnapshot,
  PageData,
  FieldType,
  Annotation,
} from "./types";
import { loadPDF, exportPDF, renderPageToDataURL } from "./services/pdfService";
import { analyzePageForFields } from "./services/geminiService";
import { saveDraft, getDraft, clearDraft } from "./services/storageService";
import { DEFAULT_FIELD_STYLE, ANNOTATION_STYLES } from "./constants";
import { useLanguage } from "./components/language-provider";
import { toast } from "sonner";
import { shouldSwitchToSelectAfterUse } from "./lib/tool-behavior";

const App: React.FC = () => {
  const { t } = useLanguage();
  const [state, setState] = useState<EditorState>({
    pdfFile: null,
    pdfBytes: null,
    pdfDocument: null,
    metadata: {},
    filename: "document.pdf",
    pages: [],
    fields: [],
    annotations: [],
    outline: [],
    selectedId: null,
    scale: 1.0,
    mode: "annotation",
    tool: "select",
    penStyle: {
      color: ANNOTATION_STYLES.ink.color,
      thickness: ANNOTATION_STYLES.ink.thickness,
      opacity: ANNOTATION_STYLES.ink.opacity,
    },
    commentStyle: {
      color: ANNOTATION_STYLES.comment.color,
      opacity: ANNOTATION_STYLES.comment.opacity,
    },
    isProcessing: false,
    past: [],
    future: [],
    clipboard: null,
    snappingOptions: {
      enabled: true,
      snapToBorders: true,
      snapToCenter: true,
      snapToEqualDistances: false,
      threshold: 8,
    },
    lastSavedAt: null,
    keys: {
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
      space: false,
    },
    actionSignal: null,
  });

  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [isPanelFloating, setIsPanelFloating] = useState(false);
  const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAIDetectOpen, setIsAIDetectOpen] = useState(false);
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState("thumbnails");
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [fitTrigger, setFitTrigger] = useState(0);
  const isClosingRef = React.useRef(false);

  // Keep a ref to access latest state in event handlers without re-binding
  const stateRef = React.useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    getDraft().then((draft) => {
      if (draft) setHasSavedSession(true);
    });
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty && !isClosingRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const handleEditAnnotation = (id: string) => {
    setIsSidebarOpen(true);
    setSidebarTab("comments");

    setState((prev) => ({
      ...prev,
      selectedId: id,
    }));

    // Try to focus the textarea in the sidebar
    setTimeout(() => {
      // We need a way to identify the textarea in the sidebar.
      // Let's assume we'll add an ID to the textarea in CommentsPanel
      const el = document.getElementById(
        `comment-input-${id}`,
      ) as HTMLTextAreaElement;
      if (el) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    }, 100);
  };

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
      const SIDEBAR_WIDTH = isSidebarOpen ? sidebarWidth : 0;
      const PANEL_WIDTH =
        !isPanelFloating && isRightPanelOpen ? rightPanelWidth : 0;
      const PADDING = 96;
      const availableWidth =
        window.innerWidth - SIDEBAR_WIDTH - PANEL_WIDTH - PADDING;
      const scale = availableWidth / page.width;
      return Math.max(0.25, Math.min(5.0, Number(scale.toFixed(2))));
    },
    [
      isSidebarOpen,
      isPanelFloating,
      isRightPanelOpen,
      sidebarWidth,
      rightPanelWidth,
    ],
  );

  const updateScale = (newScale: number) => {
    const clamped = Math.max(0.25, Math.min(5.0, newScale));
    setState((prev) => ({ ...prev, scale: clamped }));
  };

  const saveCheckpoint = useCallback(() => {
    setIsDirty(true);
    setState((prev) => {
      const snapshot: HistorySnapshot = {
        fields: prev.fields,
        annotations: prev.annotations,
        metadata: prev.metadata,
      };
      const newPast = [...prev.past, snapshot].slice(-50);
      return { ...prev, past: newPast, future: [] };
    });
  }, []);

  const handleUndo = useCallback(() => {
    setIsDirty(true);
    setState((prev) => {
      if (prev.past.length === 0) return prev;
      const previous = prev.past[prev.past.length - 1];
      const newPast = prev.past.slice(0, -1);
      const currentSnapshot: HistorySnapshot = {
        fields: prev.fields,
        annotations: prev.annotations,
        metadata: prev.metadata,
      };
      return {
        ...prev,
        fields: previous.fields,
        annotations: previous.annotations,
        metadata: previous.metadata,
        past: newPast,
        future: [currentSnapshot, ...prev.future],
        selectedId: null,
      };
    });
  }, []);

  const handleRedo = useCallback(() => {
    setIsDirty(true);
    setState((prev) => {
      if (prev.future.length === 0) return prev;
      const next = prev.future[0];
      const newFuture = prev.future.slice(1);
      const currentSnapshot: HistorySnapshot = {
        fields: prev.fields,
        annotations: prev.annotations,
        metadata: prev.metadata,
      };
      return {
        ...prev,
        fields: next.fields,
        annotations: next.annotations,
        metadata: next.metadata,
        past: [...prev.past, currentSnapshot],
        future: newFuture,
        selectedId: null,
      };
    });
  }, []);

  const handleDelete = useCallback(() => {
    saveCheckpoint();
    setState((prev) => {
      if (prev.selectedId) {
        const isField = prev.fields.some((f) => f.id === prev.selectedId);
        if (isField) {
          return {
            ...prev,
            fields: prev.fields.filter((f) => f.id !== prev.selectedId),
            selectedId: null,
          };
        }
        const isAnnotation = prev.annotations.some(
          (a) => a.id === prev.selectedId,
        );
        if (isAnnotation) {
          return {
            ...prev,
            annotations: prev.annotations.filter(
              (a) => a.id !== prev.selectedId,
            ),
            selectedId: null,
          };
        }
      }
      return prev;
    });
  }, [saveCheckpoint]);

  const handleDeleteAnnotation = (id: string) => {
    saveCheckpoint();
    setState((prev) => ({
      ...prev,
      annotations: prev.annotations.filter((a) => a.id !== id),
      selectedId: prev.selectedId === id ? null : prev.selectedId,
    }));
  };

  const handleMoveField = useCallback((actionType: string) => {
    setState((prev) => {
      if (!prev.selectedId) return prev;
      const fieldIndex = prev.fields.findIndex((f) => f.id === prev.selectedId);
      if (fieldIndex === -1) return prev;

      const field = prev.fields[fieldIndex];
      let { x, y } = field.rect;
      const isFast = actionType.endsWith("_FAST");
      const step = isFast ? 10 : 1;

      if (actionType.includes("UP")) y -= step;
      else if (actionType.includes("DOWN")) y += step;
      else if (actionType.includes("LEFT")) x -= step;
      else if (actionType.includes("RIGHT")) x += step;

      const newFields = [...prev.fields];
      newFields[fieldIndex] = { ...field, rect: { ...field.rect, x, y } };

      return { ...prev, fields: newFields };
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Update Modifier Keys
      if (
        e.key === "Control" ||
        e.key === "Shift" ||
        e.key === "Alt" ||
        e.key === "Meta"
      ) {
        setState((prev) => ({
          ...prev,
          keys: {
            ctrl: e.ctrlKey,
            shift: e.shiftKey,
            alt: e.altKey,
            meta: e.metaKey,
            space: prev.keys.space,
          },
        }));
        return;
      }

      const target = e.target as HTMLElement;
      // Identify if we are inside a text editing context
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (e.key === " " && !isInput) {
        e.preventDefault();
        setState((prev) => ({
          ...prev,
          keys: { ...prev.keys, space: true },
        }));
        return;
      }

      const currentState = stateRef.current;
      const { selectedId, mode } = currentState;

      const dispatch = (type: any) => {
        e.preventDefault();
        setState((prev) => ({
          ...prev,
          keys: {
            ...prev.keys,
            ctrl: e.ctrlKey,
            shift: e.shiftKey,
            alt: e.altKey,
            meta: e.metaKey,
          },
          actionSignal: { type, id: Date.now() },
        }));
      };

      // Handle Escape Key
      if (e.key === "Escape") {
        if (isInput) target.blur();
        dispatch("ESCAPE");
        return;
      }

      // Handle Ctrl+S (Save) - Allow even in inputs
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        dispatch("SAVE");
        return;
      }

      // Handle Ctrl+P (Print) - Allow even in inputs
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault(); // Prevent browser print
        dispatch("PRINT");
        return;
      }

      // Handle Delete/Backspace
      if (e.key === "Delete" || e.key === "Backspace") {
        if (isInput && !(target as HTMLInputElement).readOnly) {
          return;
        }
        const isSelectedField = currentState.fields.some(
          (f) => f.id === selectedId,
        );
        if (mode === "annotation" && isSelectedField) {
          return;
        }
        dispatch("DELETE");
        return;
      }

      // Block other shortcuts if typing in a writable input
      if (isInput && !(target as HTMLInputElement).readOnly) {
        return;
      }

      // Handle Arrow Keys for moving selected field
      if (
        mode === "form" &&
        selectedId &&
        currentState.fields.some((f) => f.id === selectedId) &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
      ) {
        let type = "";
        const fast = e.shiftKey ? "_FAST" : "";
        if (e.key === "ArrowUp") type = "MOVE_UP";
        else if (e.key === "ArrowDown") type = "MOVE_DOWN";
        else if (e.key === "ArrowLeft") type = "MOVE_LEFT";
        else if (e.key === "ArrowRight") type = "MOVE_RIGHT";

        if (type) dispatch(type + fast);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (e.shiftKey) dispatch("REDO");
        else dispatch("UNDO");
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        dispatch("REDO");
        return;
      }

      // Help Dialog
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        setIsShortcutsHelpOpen(true);
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (
        e.key === "Control" ||
        e.key === "Shift" ||
        e.key === "Alt" ||
        e.key === "Meta"
      ) {
        setState((prev) => ({
          ...prev,
          keys: {
            ctrl: e.ctrlKey,
            shift: e.shiftKey,
            alt: e.altKey,
            meta: e.metaKey,
            space: prev.keys.space,
          },
        }));
      }

      if (e.key === " ") {
        setState((prev) => ({
          ...prev,
          keys: { ...prev.keys, space: false },
        }));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Process Action Signals
  useEffect(() => {
    if (!state.actionSignal) return;
    const { type } = state.actionSignal;

    switch (type) {
      case "ESCAPE":
        setState((prev) => {
          if (prev.selectedId) {
            return {
              ...prev,
              selectedId: null,
            };
          }
          if (prev.tool !== "select") {
            return { ...prev, tool: "select" };
          }
          return prev;
        });
        break;
      case "DELETE":
        handleDelete();
        break;
      case "UNDO":
        handleUndo();
        break;
      case "REDO":
        handleRedo();
        break;
      case "SAVE":
        handleSaveDraft(false);
        break;
      case "PRINT":
        handlePrint();
        break;
      default:
        if (typeof type === "string" && type.startsWith("MOVE_")) {
          handleMoveField(type);
        }
        break;
    }
  }, [
    state.actionSignal,
    handleDelete,
    handleUndo,
    handleRedo,
    handleMoveField,
  ]);

  const handleUpload = async (file: File) => {
    setState((prev) => ({ ...prev, isProcessing: true }));
    setProcessingStatus(t("app.parsing"));
    try {
      const {
        pdfBytes,
        pdfDocument,
        pages,
        fields,
        annotations,
        metadata,
        outline,
      } = await loadPDF(file);
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
      setIsDirty(false);
    } catch (error) {
      console.error("Error loading PDF:", error);
      toast.error(t("app.load_error"));
      setState((prev) => ({ ...prev, isProcessing: false }));
    } finally {
      setProcessingStatus(null);
    }
  };

  const handleResumeSession = async () => {
    const draft = await getDraft();
    if (!draft) return;
    setState((prev) => ({ ...prev, isProcessing: true }));
    setProcessingStatus(t("app.loading_draft"));
    try {
      // Re-load the PDF document from bytes as it is not serializable in DB
      const {
        pdfDocument,
        pages,
        annotations: fileAnnotations,
        outline,
      } = await loadPDF(draft.pdfBytes);
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
      setIsDirty(false);
    } catch (error) {
      console.error("Failed to resume session:", error);
      toast.error(t("app.load_error"));
      setState((prev) => ({ ...prev, isProcessing: false }));
    } finally {
      setProcessingStatus(null);
    }
  };

  const handleAddField = (field: FormField) => {
    saveCheckpoint();
    setState((prev) => {
      const shouldSwitch = shouldSwitchToSelectAfterUse(prev.tool);
      const isForcedContinuous = prev.keys.ctrl || prev.keys.meta;

      return {
        ...prev,
        fields: [...prev.fields, field],
        selectedId: field.id,
        tool: shouldSwitch && !isForcedContinuous ? "select" : prev.tool,
      };
    });
  };

  const handleAddAnnotation = (annotation: Annotation) => {
    saveCheckpoint();
    setState((prev) => {
      const shouldSwitch = shouldSwitchToSelectAfterUse(prev.tool);
      const isForcedContinuous = prev.keys.ctrl || prev.keys.meta;

      return {
        ...prev,
        annotations: [...prev.annotations, annotation],
        selectedId: annotation.id,
        tool: shouldSwitch && !isForcedContinuous ? "select" : prev.tool,
      };
    });
  };

  const handleUpdateField = (id: string, updates: Partial<FormField>) => {
    setIsDirty(true);
    setState((prev) => {
      let newFields = prev.fields;
      const targetField = prev.fields.find((f) => f.id === id);

      if (!targetField) return prev;

      // Handle Radio Exclusivity
      if (updates.isChecked === true) {
        if (targetField.type === FieldType.RADIO) {
          newFields = newFields.map((f) =>
            f.name === targetField.name &&
            f.id !== id &&
            f.type === FieldType.RADIO
              ? { ...f, isChecked: false }
              : f,
          );
        }
      }

      // Sync same-name fields
      const propsToSync = [
        "value",
        "defaultValue",
        "options",
        "required",
        "readOnly",
        "toolTip",
        "multiline",
        "maxLength",
        "alignment",
      ];

      // Sync isChecked for non-radio fields (Radio logic is handled above)
      if (targetField.type !== FieldType.RADIO) {
        propsToSync.push("isChecked");
        propsToSync.push("isDefaultChecked");
      }

      const syncUpdates: Partial<FormField> = {};
      propsToSync.forEach((key) => {
        const k = key as keyof FormField;
        if (updates[k] !== undefined) {
          // @ts-ignore
          syncUpdates[k] = updates[k];
        }
      });

      if (Object.keys(syncUpdates).length > 0) {
        newFields = newFields.map((f) =>
          f.name === targetField.name &&
          f.id !== id &&
          f.type === targetField.type
            ? { ...f, ...syncUpdates }
            : f,
        );
      }

      newFields = newFields.map((f) =>
        f.id === id ? { ...f, ...updates } : f,
      );
      return { ...prev, fields: newFields };
    });
  };

  const handleUpdateAnnotation = (id: string, updates: Partial<Annotation>) => {
    setIsDirty(true);
    setState((prev) => ({
      ...prev,
      annotations: prev.annotations.map((a) =>
        a.id === id ? { ...a, ...updates } : a,
      ),
    }));
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

        setProcessingStatus(
          t("app.analyzing", {
            current: i + 1,
            total: targetPageIndices.length,
          }),
        );

        const base64Image = await renderPageToDataURL(
          state.pdfDocument,
          pageIndex,
        );

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
      setProcessingStatus(null);
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
        setProcessingStatus(t("app.generating"));

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
          setProcessingStatus(null);
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

  const handleSelectionChange = (id: string | null) => {
    setState((prev) => ({
      ...prev,
      selectedId: id,
    }));
  };

  const handleToolChange = (tool: any, preserveSelection?: boolean) => {
    setState((prev) => ({
      ...prev,
      tool,
      selectedId: preserveSelection ? prev.selectedId : null,
    }));
  };

  const handleExport = async (): Promise<boolean> => {
    setState((prev) => ({ ...prev, isProcessing: true }));
    setProcessingStatus(t("app.generating"));
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
      setProcessingStatus(null);
    }
    return false;
  };

  const handlePrint = async () => {
    setState((prev) => ({ ...prev, isProcessing: true }));
    setProcessingStatus(t("app.generating"));
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

          win.focus(); // Ensure focus for print
          win.print();

          // Fallback: 10 minutes safety timeout in case afterprint doesn't fire
          setTimeout(cleanup, 600000);
        };
      }
    } catch (error) {
      console.error("Print failed:", error);
      toast.error(t("app.export_fail"));
    } finally {
      setState((prev) => ({ ...prev, isProcessing: false }));
      setProcessingStatus(null);
    }
  };

  const handleSaveDraft = async (silent = false) => {
    if (!state.pdfBytes) return;

    setIsSaving(true);

    try {
      await saveDraft({
        pdfBytes: state.pdfBytes,
        fields: state.fields,
        annotations: state.annotations,
        metadata: state.metadata,
        filename: state.filename,
      });
      setHasSavedSession(true);
      setIsDirty(false);
      setState((prev) => ({ ...prev, lastSavedAt: new Date() }));
    } catch (error) {
      console.error("Save draft failed:", error);
      if (!silent) toast.error("Failed to save draft.");
    } finally {
      setIsSaving(false);
    }
  };

  const closeSession = async () => {
    isClosingRef.current = true;
    await clearDraft();
    window.location.reload();
  };

  const handleCloseRequest = () => {
    setIsCloseDialogOpen(true);
  };

  const selectedField =
    state.selectedId && state.fields.find((f) => f.id === state.selectedId)
      ? state.fields.find((f) => f.id === state.selectedId) || null
      : null;

  const handlePenStyleChange = (style: Partial<EditorState["penStyle"]>) => {
    setState((prev) => ({
      ...prev,
      penStyle: { ...prev.penStyle, ...style },
    }));
  };

  const handleCommentStyleChange = (style: { color: string }) => {
    setState((prev) => ({
      ...prev,
      commentStyle: { ...prev.commentStyle, ...style },
    }));
  };

  return (
    <div className="flex h-full w-full flex-col">
      {state.pages.length === 0 ? (
        <LandingPage
          onUpload={handleUpload}
          hasSavedSession={hasSavedSession}
          onResume={handleResumeSession}
        />
      ) : (
        <>
          <Toolbar
            editorState={state}
            isSaving={isSaving}
            isDirty={isDirty}
            onToolChange={(tool) =>
              setState((prev) => ({
                ...prev,
                tool,
                selectedId: null,
              }))
            }
            onModeChange={(mode) =>
              setState((prev) => ({ ...prev, mode, tool: "select" }))
            }
            onPenStyleChange={handlePenStyleChange}
            onCommentStyleChange={handleCommentStyleChange}
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
            onCustomAutoDetect={() => setIsAIDetectOpen(true)}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={state.past.length > 0}
            canRedo={state.future.length > 0}
            onOpenShortcuts={() => setIsShortcutsHelpOpen(true)}
            isFieldListOpen={isSidebarOpen}
            onToggleFieldList={() => setIsSidebarOpen(!isSidebarOpen)}
            isPropertiesPanelOpen={isRightPanelOpen}
            onTogglePropertiesPanel={() =>
              setIsRightPanelOpen(!isRightPanelOpen)
            }
            onOpenSettings={() => setIsSettingsOpen(true)}
          />

          <div className="relative flex flex-1 overflow-hidden">
            <Sidebar
              isOpen={isSidebarOpen}
              onClose={() => setIsSidebarOpen(false)}
              pages={state.pages}
              fields={state.fields}
              annotations={state.annotations}
              outline={state.outline}
              selectedId={state.selectedId}
              onSelectControl={(id) => {
                setState((prev) => ({
                  ...prev,
                  selectedId: id,
                }));
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
              onDeleteAnnotation={handleDeleteAnnotation}
              onUpdateAnnotation={handleUpdateAnnotation}
              onNavigatePage={(idx) => {
                document
                  .getElementById(`page-${idx}`)
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
              currentPageIndex={currentPageIndex}
              width={sidebarWidth}
              onResize={setSidebarWidth}
              pdfDocument={state.pdfDocument}
              activeTab={sidebarTab}
              onTabChange={setSidebarTab}
            />

            <div className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden">
              <Workspace
                editorState={state}
                onAddField={handleAddField}
                onAddAnnotation={handleAddAnnotation}
                onSelectControl={handleSelectionChange}
                onUpdateField={handleUpdateField}
                onUpdateAnnotation={handleUpdateAnnotation}
                onDeleteAnnotation={handleDeleteAnnotation}
                onEditAnnotation={handleEditAnnotation}
                onScaleChange={updateScale}
                onTriggerHistorySave={saveCheckpoint}
                onPageIndexChange={setCurrentPageIndex}
                onToolChange={handleToolChange}
                fitTrigger={fitTrigger}
              />
              <ZoomControls
                scale={state.scale}
                onZoomIn={() => updateScale(state.scale * 1.25)}
                onZoomOut={() => updateScale(state.scale / 1.25)}
                onReset={() => {
                  updateScale(calculateFitScale(state.pages, currentPageIndex));
                  setFitTrigger(Date.now());
                }}
              />
            </div>

            {state.mode === "form" && isRightPanelOpen && (
              <PropertiesPanel
                field={selectedField}
                metadata={state.metadata}
                filename={state.filename}
                onChange={(updates) =>
                  selectedField && handleUpdateField(selectedField.id, updates)
                }
                onMetadataChange={(m) =>
                  setState((prev) => ({
                    ...prev,
                    metadata: { ...prev.metadata, ...m },
                  }))
                }
                onFilenameChange={(name) =>
                  setState((prev) => ({ ...prev, filename: name }))
                }
                onDelete={handleDelete}
                onClose={() =>
                  setState((prev) => ({ ...prev, selectedId: null }))
                }
                isFloating={isPanelFloating}
                onToggleFloating={() => setIsPanelFloating(!isPanelFloating)}
                onTriggerHistorySave={saveCheckpoint}
                width={rightPanelWidth}
                onResize={setRightPanelWidth}
              />
            )}
          </div>
        </>
      )}

      <KeyboardShortcutsHelp
        isOpen={isShortcutsHelpOpen}
        onClose={() => setIsShortcutsHelpOpen(false)}
      />
      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        options={state.snappingOptions}
        onChange={(o) => setState((prev) => ({ ...prev, snappingOptions: o }))}
      />
      <AIDetectionDialog
        isOpen={isAIDetectOpen}
        onClose={() => setIsAIDetectOpen(false)}
        onConfirm={handleAdvancedDetect}
        totalPages={state.pages.length}
      />

      <Dialog open={isCloseDialogOpen} onOpenChange={setIsCloseDialogOpen}>
        <DialogContent>
          <DialogTitle>{t("dialog.confirm_close.title")}</DialogTitle>
          <DialogDescription>
            {t("dialog.confirm_close.desc")}
          </DialogDescription>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCloseDialogOpen(false)}
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
            {processingStatus || t("common.processing")}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default App;
