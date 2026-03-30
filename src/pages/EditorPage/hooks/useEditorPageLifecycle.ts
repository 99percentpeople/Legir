import React from "react";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useEventListener } from "@/hooks/useEventListener";
import { recentFilesService } from "@/services/recentFilesService";
import {
  closePlatformWindow,
  listenForPlatformCloseRequested,
  saveDraftViewStateIfSupported,
  saveEditorViewState,
  setPlatformWindowTitle,
} from "@/services/platform";
import { useEditorStore } from "@/store/useEditorStore";
import type { EditorPageCloseSource } from "../types";

interface UseEditorPageLifecycleOptions {
  filename: string;
  pagesLength: number;
  isDirty: boolean;
  pdfBytes: Uint8Array | ArrayBuffer | null | undefined;
  fieldsFingerprint: unknown;
  annotationsFingerprint: unknown;
  metadataFingerprint: unknown;
  platformDocumentSaveMode: "draft" | "file";
  onSaveDraft: (silent?: boolean) => Promise<void>;
  onRequestCloseConfirm: (source: EditorPageCloseSource) => void;
}

export function useEditorPageLifecycle({
  filename,
  pagesLength,
  isDirty,
  pdfBytes,
  fieldsFingerprint,
  annotationsFingerprint,
  metadataFingerprint,
  platformDocumentSaveMode,
  onSaveDraft,
  onRequestCloseConfirm,
}: UseEditorPageLifecycleOptions) {
  const workspaceScrollContainerRef = React.useRef<HTMLElement | null>(null);
  const initialTitleRef = React.useRef<string | null>(null);
  const skipNextWindowCloseRef = React.useRef(false);
  const webViewStateRef = React.useRef({
    lastScroll: null as { left: number; top: number } | null,
    cleanup: null as null | (() => void),
    rafId: null as number | null,
    lastSaveAt: 0,
  });

  const persistDraftViewState = React.useCallback(() => {
    const snapshot = useEditorStore.getState();
    const el = workspaceScrollContainerRef.current;
    if (!el) return;

    const last = webViewStateRef.current.lastScroll;
    saveDraftViewStateIfSupported({
      pagesLength: snapshot.pages.length,
      scale: snapshot.scale,
      scrollContainer:
        last === null
          ? el
          : {
              scrollLeft: last.left,
              scrollTop: last.top,
            },
    });
  }, []);

  const persistEditorViewState = React.useCallback(() => {
    const snapshot = useEditorStore.getState();
    saveEditorViewState({
      saveTarget: snapshot.saveTarget,
      pagesLength: snapshot.pages.length,
      scale: snapshot.scale,
      currentPageIndex: snapshot.currentPageIndex,
      scrollContainer: workspaceScrollContainerRef.current,
    });
  }, []);

  const closeWindow = React.useCallback(async () => {
    recentFilesService.cancelPreviewTasks();
    persistEditorViewState();
    skipNextWindowCloseRef.current = true;
    await closePlatformWindow();
  }, [persistEditorViewState]);

  useAppEvent(
    "workspace:scrollContainerReady",
    ({ element }) => {
      workspaceScrollContainerRef.current = element;

      try {
        webViewStateRef.current.cleanup?.();
      } catch {
        // ignore
      }
      webViewStateRef.current.cleanup = null;

      const update = () => {
        webViewStateRef.current.lastScroll = {
          left: element.scrollLeft,
          top: element.scrollTop,
        };

        if (webViewStateRef.current.rafId !== null) return;
        if (typeof window === "undefined") return;
        webViewStateRef.current.rafId = window.requestAnimationFrame(() => {
          webViewStateRef.current.rafId = null;
          const now = Date.now();
          if (now - webViewStateRef.current.lastSaveAt < 200) return;
          webViewStateRef.current.lastSaveAt = now;
          const snapshot = useEditorStore.getState();
          if (!snapshot.pages || snapshot.pages.length === 0) return;
          const last = webViewStateRef.current.lastScroll ?? {
            left: element.scrollLeft,
            top: element.scrollTop,
          };
          saveDraftViewStateIfSupported({
            pagesLength: snapshot.pages.length,
            scale: snapshot.scale,
            scrollContainer: {
              scrollLeft: last.left,
              scrollTop: last.top,
            },
          });
        });
      };

      update();
      element.addEventListener("scroll", update, { passive: true });
      webViewStateRef.current.cleanup = () => {
        element.removeEventListener("scroll", update);
      };
    },
    { replayLast: true },
  );

  React.useEffect(() => {
    return () => {
      try {
        webViewStateRef.current.cleanup?.();
      } catch {
        // ignore
      }
      webViewStateRef.current.cleanup = null;

      if (webViewStateRef.current.rafId !== null) {
        try {
          if (typeof window !== "undefined") {
            window.cancelAnimationFrame(webViewStateRef.current.rafId);
          }
        } catch {
          // ignore
        }
      }
      webViewStateRef.current.rafId = null;
    };
  }, []);

  React.useEffect(() => {
    const appName = process.env.APP_NAME;

    if (typeof document !== "undefined" && initialTitleRef.current === null) {
      initialTitleRef.current = document.title;
    }

    const hasOpenDocument = pagesLength > 0;
    const nextTitle = hasOpenDocument
      ? `${filename || appName} - ${appName}`
      : appName;

    void setPlatformWindowTitle(nextTitle).catch(() => {
      // ignore
    });

    return () => {
      void setPlatformWindowTitle(initialTitleRef.current ?? appName).catch(
        () => {
          // ignore
        },
      );
    };
  }, [filename, pagesLength]);

  React.useEffect(() => {
    let unlisten: null | (() => void) = null;
    let cancelled = false;

    void (async () => {
      unlisten = await listenForPlatformCloseRequested((event) => {
        if (skipNextWindowCloseRef.current) {
          skipNextWindowCloseRef.current = false;
          return;
        }

        recentFilesService.cancelPreviewTasks();

        const snapshot = useEditorStore.getState();
        if (!snapshot.pages || snapshot.pages.length === 0) return;

        persistEditorViewState();

        if (!snapshot.isDirty) return;
        event.preventDefault();
        onRequestCloseConfirm("window");
      });

      if (cancelled) {
        try {
          unlisten?.();
        } catch {
          // ignore
        }
        unlisten = null;
      }
    })();

    return () => {
      cancelled = true;
      try {
        unlisten?.();
      } catch {
        // ignore
      }
    };
  }, [onRequestCloseConfirm, persistEditorViewState]);

  useEventListener<BeforeUnloadEvent>(
    typeof window !== "undefined" ? window : null,
    "beforeunload",
    (event) => {
      persistDraftViewState();
      if (platformDocumentSaveMode === "draft" && pagesLength > 0 && isDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    },
  );

  useEventListener(
    typeof window !== "undefined" ? window : null,
    "pagehide",
    () => {
      persistDraftViewState();
      if (platformDocumentSaveMode !== "draft") return;
      const snapshot = useEditorStore.getState();
      if (snapshot.isDirty) {
        void onSaveDraft(true);
      }
    },
  );

  useEventListener(
    typeof document !== "undefined" ? document : null,
    "visibilitychange",
    () => {
      if (document.visibilityState !== "hidden") return;
      persistDraftViewState();
      if (platformDocumentSaveMode !== "draft") return;
      const snapshot = useEditorStore.getState();
      if (snapshot.isDirty) {
        void onSaveDraft(true);
      }
    },
  );

  React.useEffect(() => {
    if (platformDocumentSaveMode !== "draft") return;
    if (pagesLength > 0 && pdfBytes) {
      const timer = setTimeout(() => {
        if (!isDirty) return;
        void onSaveDraft(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [
    annotationsFingerprint,
    fieldsFingerprint,
    filename,
    isDirty,
    metadataFingerprint,
    onSaveDraft,
    pagesLength,
    pdfBytes,
    platformDocumentSaveMode,
  ]);

  return {
    workspaceScrollContainerRef,
    closeWindow,
  };
}
