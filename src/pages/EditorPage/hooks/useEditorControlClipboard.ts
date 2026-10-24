import { toast } from "sonner";
import { useEditorTabIsActive } from "@/app/editorTabs/context";
import { useLanguage } from "@/components/language-provider";
import { useEventListener } from "@/hooks/useEventListener";
import {
  copySelectedControl,
  readControlClipboard,
  writeControlClipboard,
} from "@/lib/controlClipboard";
import { PdfPermissionDeniedError } from "@/lib/pdfPermissions";
import { useEditorViewApi } from "@/store/useEditorView";

const ownsTextClipboard = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"]',
  );

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
