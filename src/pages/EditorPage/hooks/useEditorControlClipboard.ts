import { toast } from "sonner";
import { useCallback } from "react";
import { useEditorTabIsActive } from "@/app/editorTabs/context";
import { useEditorTabRuntime } from "@/app/editorTabs/runtimeContext";
import { useLanguage } from "@/components/language-provider";
import { useEventListener } from "@/hooks/useEventListener";
import { createClipboardData, ownsTextClipboard } from "@/lib/clipboard";
import type { ControlPasteTarget } from "@/lib/controlClipboard/types";
import {
  copySelectedControl,
  readControlClipboard,
  writeControlClipboard,
} from "@/lib/controlClipboard";
import { PdfPermissionDeniedError } from "@/lib/pdfPermissions";
import { useEditorViewApi } from "@/store/useEditorView";

export function useEditorControlClipboardActions() {
  const editor = useEditorViewApi();
  const runtime = useEditorTabRuntime();
  const { t } = useLanguage();
  const reportError = useCallback(
    (error: unknown) => {
      toast.error(
        t(
          error instanceof PdfPermissionDeniedError
            ? "toolbar.permission_restricted"
            : "common.clipboard_unavailable",
        ),
      );
    },
    [t],
  );
  const copyControl = useCallback(
    async (id: string) => {
      try {
        const state = editor.getState();
        if (state.documentLoadState !== "ready" || (runtime && !runtime.active))
          return;
        const control = copySelectedControl(state, id);
        if (!control) return;
        const data = createClipboardData();
        writeControlClipboard(data, control);
        await navigator.clipboard.writeText(data.getData("text/plain"));
      } catch (error) {
        reportError(error);
      }
    },
    [editor, runtime, reportError],
  );
  const pasteControl = useCallback(
    async (target: ControlPasteTarget) => {
      const before = editor.getState();
      try {
        const text = await navigator.clipboard.readText();
        const state = editor.getState();
        if (
          state.pdfBytes !== before.pdfBytes ||
          state.activeDialog ||
          (runtime && (!runtime.active || runtime.disposed))
        )
          return;
        const control = readControlClipboard(createClipboardData(text));
        if (!control) {
          toast.error(t("common.clipboard_empty"));
          return;
        }
        state.pasteControl(control, target);
      } catch (error) {
        reportError(error);
      }
    },
    [editor, runtime, reportError, t],
  );
  return { copyControl, pasteControl };
}

/** Native events support Ctrl/Cmd shortcuts and the browser's Copy/Paste menus. */
export function useEditorControlClipboard() {
  const editor = useEditorViewApi();
  const isActive = useEditorTabIsActive();
  const { t } = useLanguage();
  const handleClipboard = (event: ClipboardEvent) => {
    const state = editor.getState();
    if (
      !isActive ||
      event.defaultPrevented ||
      !event.clipboardData ||
      state.activeDialog ||
      state.mode === "pages" ||
      state.documentLoadState !== "ready" ||
      ownsTextClipboard(event.target) ||
      ownsTextClipboard(document.activeElement)
    )
      return;
    try {
      if (event.type === "copy") {
        if (window.getSelection()?.toString()) return;
        const control = copySelectedControl(state);
        if (!control) return;
        writeControlClipboard(event.clipboardData, control);
        event.preventDefault();
      } else {
        const control = readControlClipboard(event.clipboardData);
        if (!control) return;
        event.preventDefault();
        state.pasteControl(control);
      }
    } catch (error) {
      if (error instanceof PdfPermissionDeniedError) {
        event.preventDefault();
        toast.error(t("toolbar.permission_restricted"));
      } else {
        console.error("Control clipboard operation failed", error);
      }
    }
  };
  useEventListener(window, "copy", handleClipboard);
  useEventListener(window, "paste", handleClipboard);
}
