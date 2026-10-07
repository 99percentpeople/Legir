import { createContext } from "react";
import type { EditorViewApi } from "./editorView";

export const EditorViewContext = createContext<EditorViewApi | null>(null);
