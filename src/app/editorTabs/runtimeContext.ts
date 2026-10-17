import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";
import { EditorTabUiContext } from "./context";
import type { EditorTabRuntime } from "./runtime";

const EditorTabContext = createContext<EditorTabRuntime | null>(null);

export const useEditorTabRuntime = () => useContext(EditorTabContext);

/** Share one document owner with runtime consumers and presentational UI. */
export function EditorTabProvider({
  value,
  children,
}: {
  value: EditorTabRuntime;
  children: ReactNode;
}) {
  return createElement(
    EditorTabContext.Provider,
    { value },
    createElement(EditorTabUiContext.Provider, { value }, children),
  );
}
