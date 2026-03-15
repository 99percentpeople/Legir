import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { getStartupOpenPdfArg, openFileFromPath } from "../services/fileOps";
import { recentFilesService } from "../services/recentFilesService";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEditorStore, type EditorActions } from "../store/useEditorStore";
import type { EditorState } from "../types";
import { loadModels } from "@/services/ai";

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
      const CANCELLED = Symbol("cancelled");
      const throwIfCancelled = () => {
        if (cancelled) throw CANCELLED;
      };

      void loadModels();

      try {
        const startupPath = await getStartupOpenPdfArg();
        throwIfCancelled();

        if (startupPath) {
          const picked = await openFileFromPath(startupPath);
          throwIfCancelled();
          await loadIntoEditor({
            input: picked.bytes,
            pdfFile: null,
            filename: picked.filename,
            saveTarget: { kind: "tauri", path: startupPath },
          });
          throwIfCancelled();
        }
      } catch (e) {
        if (e !== CANCELLED) {
          console.error("Failed to fetch pending argv PDF:", e);
        }
      }

      setState({
        hasSavedSession: recentFilesService.hasWebSession(),
      });

      if (!isTauri()) return;

      try {
        const snapshot = useEditorStore.getState();
        const existing = snapshot.options?.userName;
        if (!existing) {
          const name = await invoke<string | null>("get_system_username");
          throwIfCancelled();
          const current = useEditorStore.getState().options?.userName;
          if (!current && typeof name === "string" && name.trim().length > 0) {
            useEditorStore.getState().setOptions({ userName: name.trim() });
          }
        }

        const webview = getCurrentWebview();
        unlisten = await webview.onDragDropEvent((event: unknown) => {
          const payload =
            typeof event === "object" && event !== null && "payload" in event
              ? (event as { payload?: unknown }).payload
              : null;

          if (typeof payload !== "object" || payload === null) return;
          if (
            !("type" in payload) ||
            (payload as { type?: unknown }).type !== "drop"
          )
            return;

          const rawPaths = (payload as { paths?: unknown }).paths;
          const paths: string[] = Array.isArray(rawPaths)
            ? rawPaths.filter((p): p is string => typeof p === "string")
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
      } catch (e) {
        if (e !== CANCELLED) {
          // ignore
        }
      } finally {
        if (cancelled) {
          unlisten?.();
          unlisten = null;
        }
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
