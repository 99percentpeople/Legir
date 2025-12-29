import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { getStartupOpenPdfArg, openFileFromPath } from "../services/fileOps";
import { recentFilesService } from "../services/recentFilesService";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEditorStore, type EditorActions } from "../store/useEditorStore";
import type { EditorState } from "../types";

export function useAppInitialization({
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
  pdfDisposeRef: RefObject<null | (() => void)>;
  openDroppedPdfPath: (filePath: string) => Promise<void>;
  setPendingFileDropPath: Dispatch<SetStateAction<string | null>>;
  setFileDropDialogOpen: Dispatch<SetStateAction<boolean>>;
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

      if (!cancelled) {
        setState({
          hasSavedSession: recentFilesService.getWebHasSavedSession(),
        });
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
