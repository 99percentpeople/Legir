import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useEditorTabIsActive } from "@/app/editorTabs/context";
import { useEditorTabRuntime } from "@/app/editorTabs/runtimeContext";
import { useLanguage } from "@/components/language-provider";
import { useEventListener } from "@/hooks/useEventListener";
import { createClipboardData, ownsTextClipboard } from "@/lib/clipboard";
import {
  assertPdfPermissionOperation,
  PdfPermissionDeniedError,
} from "@/lib/pdfPermissions";
import {
  readPageClipboard,
  readPageClipboardId,
  writePageClipboard,
} from "@/services/pageClipboard";
import { exportSelectedPages } from "@/services/pdfService/pageClipboard";
import { getPageId } from "@/services/pdfService/lib/pageStructure";
import { useEditorViewApi } from "@/store/useEditorView";

export function usePageClipboard({
  busy,
  onPaste,
}: {
  busy: boolean;
  onPaste: (file: Promise<File>, insertionIndex?: number) => void;
}) {
  const store = useEditorViewApi();
  const active = useEditorTabIsActive();
  const runtime = useEditorTabRuntime();
  const { t } = useLanguage();
  const pendingPaste = useRef<AbortController | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => () => pendingPaste.current?.abort(), []);
  const copy = (data: Pick<DataTransfer, "setData">, ids?: string[]) => {
    const state = ids
      ? { ...store.getState(), selectedPageIds: ids }
      : store.getState();
    const selected = new Set(state.selectedPageIds);
    const count = state.pages.filter((page) =>
      selected.has(getPageId(page)),
    ).length;
    if (!count) return;
    assertPdfPermissionOperation("copy_text", state.documentPermissions);
    const ready = writePageClipboard(data, state.filename || "pages.pdf", () =>
      exportSelectedPages(state, runtime?.signal),
    );
    return { ready, count };
  };
  const notifyCopy = (ready: Promise<unknown>, count: number) => {
    toast.promise(ready, {
      loading: t("page_editor.copying"),
      success: t("page_editor.copied", { count }),
      error: t("page_editor.copy_failed"),
    });
  };
  const paste = (data: Pick<DataTransfer, "getData">, index?: number) => {
    const id = readPageClipboardId(data);
    if (!id) return false;
    assertPdfPermissionOperation(
      "assemble_pages",
      store.getState().documentPermissions,
    );
    pendingPaste.current?.abort();
    pendingPaste.current = new AbortController();
    onPaste(readPageClipboard(id, pendingPaste.current.signal), index);
    return true;
  };
  const reportError = (error: unknown) =>
    toast.error(
      t(
        error instanceof PdfPermissionDeniedError
          ? "toolbar.permission_restricted"
          : "common.clipboard_unavailable",
      ),
    );
  const available = () => {
    const state = store.getState();
    return (
      active &&
      !busyRef.current &&
      !state.activeDialog &&
      state.mode === "pages" &&
      state.documentLoadState === "ready" &&
      !runtime?.disposed &&
      (!runtime || runtime.active) &&
      !runtime?.root?.querySelector('[data-page-dragging="true"]')
    );
  };
  const copyPages = async (ids?: string[]) => {
    if (!available()) return;
    try {
      const data = createClipboardData();
      const copied = copy(data, ids);
      if (!copied) return;
      const written = navigator.clipboard.writeText(data.getData("text/plain"));
      notifyCopy(Promise.all([written, copied.ready]), copied.count);
      await written;
    } catch (error) {
      reportError(error);
    }
  };
  const pastePages = async (index?: number) => {
    if (!available()) return;
    const before = store.getState();
    try {
      const text = await navigator.clipboard.readText();
      const state = store.getState();
      if (
        !available() ||
        state.pdfBytes !== before.pdfBytes ||
        state.pages !== before.pages
      )
        return;
      if (!paste(createClipboardData(text), index))
        toast.error(t("common.clipboard_empty"));
    } catch (error) {
      reportError(error);
    }
  };
  const handle = (event: ClipboardEvent) => {
    const state = store.getState();
    if (
      !active ||
      busy ||
      event.defaultPrevented ||
      !event.clipboardData ||
      state.activeDialog ||
      state.mode !== "pages" ||
      state.documentLoadState !== "ready" ||
      ownsTextClipboard(event.target) ||
      ownsTextClipboard(document.activeElement) ||
      runtime?.root?.querySelector('[data-page-dragging="true"]')
    )
      return;
    try {
      if (event.type === "copy") {
        if (window.getSelection()?.toString()) return;
        const copied = copy(event.clipboardData);
        if (copied) {
          event.preventDefault();
          notifyCopy(copied.ready, copied.count);
        }
      } else if (paste(event.clipboardData)) event.preventDefault();
    } catch (error) {
      event.preventDefault();
      reportError(error);
    }
  };
  useEventListener(window, "copy", handle);
  useEventListener(window, "paste", handle);
  // Keep menu callbacks stable so selection changes don't rerender every card.
  const actions = useRef({ copyPages, pastePages });
  actions.current = { copyPages, pastePages };
  const menuCopy = useCallback(
    (ids?: string[]) => actions.current.copyPages(ids),
    [],
  );
  const menuPaste = useCallback(
    (index?: number) => actions.current.pastePages(index),
    [],
  );
  return { copyPages: menuCopy, pastePages: menuPaste };
}
