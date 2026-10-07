import { createContext, useCallback, useContext } from "react";
import { appEventBus } from "@/lib/eventBus";
import type { EditorTabRuntime } from "./runtime";

// Context-only module: shared presentational components (including www) must
// not import the application store or instantiate a document runtime.
export const EditorTabContext = createContext<EditorTabRuntime | null>(null);
export const EditorTabActiveContext = createContext(true);
export const useEditorTabRuntime = () => useContext(EditorTabContext);
export const useEditorTabIsActive = () => useContext(EditorTabActiveContext);
export const useEditorEventBus = () =>
  useEditorTabRuntime()?.events ?? appEventBus;
export const useEditorElementById = () => {
  const runtime = useEditorTabRuntime();
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
