import React from "react";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useEventListener } from "@/hooks/useEventListener";
import { setPlatformWindowTitle } from "@/services/platform";

interface UseEditorPageLifecycleOptions {
  filename: string;
  pagesLength: number;
  isDirty: boolean;
  hasDirtyTabs: boolean;
  pdfBytes: Uint8Array | ArrayBuffer | null | undefined;
  fieldsFingerprint: unknown;
  annotationsFingerprint: unknown;
  metadataFingerprint: unknown;
  platformDocumentSaveMode: "draft" | "file";
  onSaveDraft: (silent?: boolean) => Promise<boolean>;
}

export function useEditorPageLifecycle({
  filename,
  pagesLength,
  isDirty,
  hasDirtyTabs,
  pdfBytes,
  fieldsFingerprint,
  annotationsFingerprint,
  metadataFingerprint,
  platformDocumentSaveMode,
  onSaveDraft,
}: UseEditorPageLifecycleOptions) {
  const workspaceScrollContainerRef = React.useRef<HTMLElement | null>(null);
  const initialTitleRef = React.useRef<string | null>(null);

  useAppEvent(
    "workspace:scrollContainerReady",
    ({ element }) => {
      workspaceScrollContainerRef.current = element;
    },
    { replayLast: true },
  );

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

  useEventListener<BeforeUnloadEvent>(
    typeof window !== "undefined" ? window : null,
    "beforeunload",
    (event) => {
      if (
        platformDocumentSaveMode === "draft" &&
        pagesLength > 0 &&
        hasDirtyTabs
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    },
  );

  useEventListener(
    typeof window !== "undefined" ? window : null,
    "pagehide",
    () => {
      if (platformDocumentSaveMode !== "draft") return;
      if (pagesLength > 0) {
        void onSaveDraft(true);
      }
    },
  );

  useEventListener(
    typeof document !== "undefined" ? document : null,
    "visibilitychange",
    () => {
      if (document.visibilityState !== "hidden") return;
      if (platformDocumentSaveMode !== "draft") return;
      if (pagesLength > 0) {
        void onSaveDraft(true);
      }
    },
  );

  React.useEffect(() => {
    if (platformDocumentSaveMode !== "draft") return;
    if (pagesLength > 0 && pdfBytes) {
      const timer = setTimeout(() => {
        if (!isDirty && !hasDirtyTabs) return;
        void onSaveDraft(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [
    annotationsFingerprint,
    fieldsFingerprint,
    filename,
    hasDirtyTabs,
    isDirty,
    metadataFingerprint,
    onSaveDraft,
    pagesLength,
    pdfBytes,
    platformDocumentSaveMode,
  ]);

  return {
    workspaceScrollContainerRef,
  };
}
