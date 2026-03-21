import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { useEditorStore, type EditorActions } from "../store/useEditorStore";
import type { EditorState } from "../types";
import { loadModels } from "@/services/ai";
import {
  getPlatformUserName,
  getStartupOpenDocumentPath,
  hasSavedDraftSession,
  listenForPlatformFileDrop,
  openFileFromPath,
} from "@/services/platform";

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
        const startupPath = await getStartupOpenDocumentPath();
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
        hasSavedSession: hasSavedDraftSession(),
      });

      try {
        const snapshot = useEditorStore.getState();
        const existing = snapshot.options?.userName;
        if (!existing) {
          const name = await getPlatformUserName();
          throwIfCancelled();
          const current = useEditorStore.getState().options?.userName;
          if (!current && typeof name === "string" && name.trim().length > 0) {
            useEditorStore.getState().setOptions({ userName: name.trim() });
          }
        }

        unlisten = await listenForPlatformFileDrop((firstPdf) => {
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
