import { createContext, useCallback, useContext } from "react";
import { appEventBus, type AppEventMap, type EventBus } from "@/lib/eventBus";

interface EditorTabUiRuntime {
  events: EventBus<AppEventMap>;
  root: HTMLElement | null;
  active: boolean;
}

// Context-only module: shared presentational components (including www) must
// not import the application store, even through type-only dependencies.
export const EditorTabUiContext = createContext<EditorTabUiRuntime | null>(
  null,
);
export const EditorTabActiveContext = createContext(true);
export const useEditorTabUiRuntime = () => useContext(EditorTabUiContext);
export const useEditorTabIsActive = () => useContext(EditorTabActiveContext);
export const useEditorEventBus = () =>
  useEditorTabUiRuntime()?.events ?? appEventBus;
export const useEditorElementById = () => {
  const runtime = useEditorTabUiRuntime();
  return useCallback(
    (id: string): HTMLElement | null => {
      if (!runtime)
        return typeof document === "undefined"
          ? null
          : document.getElementById(id);
      return (
        runtime.root?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) ??
        null
      );
    },
    [runtime],
  );
};
