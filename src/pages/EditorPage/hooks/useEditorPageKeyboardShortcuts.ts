import { useEventListener } from "@/hooks/useEventListener";
import { useEditorStore } from "@/store/useEditorStore";
import type { MoveDirection, Tool } from "@/types";

interface UseEditorPageKeyboardShortcutsOptions {
  defaultTool: Tool;
  isPdfSearchOpen: boolean;
  openPdfSearch: () => void;
  closePdfSearch: () => void;
  runPrimarySaveAction: () => Promise<boolean>;
  onPrint: () => void;
  onToggleFullscreen: () => void;
}

export function useEditorPageKeyboardShortcuts({
  defaultTool,
  isPdfSearchOpen,
  openPdfSearch,
  closePdfSearch,
  runPrimarySaveAction,
  onPrint,
  onToggleFullscreen,
}: UseEditorPageKeyboardShortcutsOptions) {
  useEventListener(
    typeof window !== "undefined" ? window : null,
    "keydown",
    (event: KeyboardEvent) => {
      if (event.key === "F11") {
        event.preventDefault();
        onToggleFullscreen();
      }
    },
  );

  useEventListener<KeyboardEvent>(
    typeof window !== "undefined" ? window : null,
    "keydown",
    (event) => {
      const currentState = useEditorStore.getState();

      if (
        event.key === "Control" ||
        event.key === "Shift" ||
        event.key === "Alt" ||
        event.key === "Meta"
      ) {
        currentState.setKeys({
          ctrl: event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          meta: event.metaKey,
          space: currentState.keys.space,
        });
        return;
      }

      const target = event.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (event.key === " " && !isInput) {
        event.preventDefault();
        event.stopPropagation();
        if (!currentState.keys.space) {
          currentState.setKeys({ space: true });
        }
        return;
      }

      if (event.key === "Escape") {
        if (!event.isTrusted) return;
        if (currentState.activeDialog) return;
        if (isPdfSearchOpen) {
          event.preventDefault();
          if (isInput) target.blur();
          closePdfSearch();
          return;
        }
        if (isInput) target.blur();
        if (currentState.selectedId) {
          currentState.selectControl(null);
        } else if (currentState.tool !== defaultTool) {
          currentState.setTool(defaultTool);
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void runPrimarySaveAction();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        onPrint();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openPdfSearch();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (isInput && !(target as HTMLInputElement).readOnly) {
          return;
        }
        const isSelectedField = currentState.fields.some(
          (field) => field.id === currentState.selectedId,
        );
        if (currentState.mode === "annotation" && isSelectedField) {
          return;
        }
        currentState.deleteSelection();
        return;
      }

      if (isInput && !(target as HTMLInputElement).readOnly) {
        return;
      }

      const isMoveKey = [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ].includes(event.key);
      const isKeyboardHandleTarget =
        target instanceof HTMLElement &&
        !!target.closest("[data-app-keyboard-handle]");
      const isSelectedField = currentState.fields.some(
        (field) => field.id === currentState.selectedId,
      );
      const isSelectedAnnotation = currentState.annotations.some(
        (annotation) => annotation.id === currentState.selectedId,
      );

      if (
        !isKeyboardHandleTarget &&
        currentState.selectedId &&
        isMoveKey &&
        ((currentState.mode === "form" && isSelectedField) ||
          (currentState.mode === "annotation" && isSelectedAnnotation))
      ) {
        event.preventDefault();
        const isFast = event.shiftKey;
        let direction: MoveDirection = "UP";
        if (event.key === "ArrowUp") direction = "UP";
        else if (event.key === "ArrowDown") direction = "DOWN";
        else if (event.key === "ArrowLeft") direction = "LEFT";
        else if (event.key === "ArrowRight") direction = "RIGHT";
        currentState.moveSelectedControl(direction, isFast);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        if (event.shiftKey) currentState.redo();
        else currentState.undo();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        currentState.redo();
        return;
      }

      if (event.key === "?" || (event.shiftKey && event.key === "/")) {
        currentState.openDialog("shortcuts");
      }
    },
    true,
  );

  useEventListener<KeyboardEvent>(
    typeof window !== "undefined" ? window : null,
    "keyup",
    (event) => {
      const currentState = useEditorStore.getState();
      if (
        event.key === "Control" ||
        event.key === "Shift" ||
        event.key === "Alt" ||
        event.key === "Meta"
      ) {
        currentState.setKeys({
          ctrl: event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          meta: event.metaKey,
          space: currentState.keys.space,
        });
      }

      if (event.key === " ") {
        currentState.setKeys({ space: false });
      }
    },
    true,
  );
}
