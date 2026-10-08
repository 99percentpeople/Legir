import type { EditorShellCommands } from "@/app/editorShellContext";
import type { EditorState } from "@/types";
import type { ShapeBorderStyle } from "@/lib/shapeGeometry";
import type { ReactNode } from "react";

export interface ResponsiveToolbarItem {
  id: string;
  label: string;
  content: ReactNode;
  pinned?: boolean;
}

export interface StrokePreviewProps {
  variant?: "stroke" | "highlight";
  color: string;
  thickness: number;
  opacity?: number;
  linecap?: "round" | "butt" | "square";
  borderStyle?: ShapeBorderStyle;
  dashDensity?: number;
  compact?: boolean;
}

export interface StrokeWidthControlProps extends StrokePreviewProps {
  min?: number;
  onChange: (value: number) => void;
}

export type ToolOptionsState = Pick<
  EditorState,
  | "tool"
  | "penStyle"
  | "highlightStyle"
  | "commentStyle"
  | "freetextStyle"
  | "shapeStyle"
  | "stampStyle"
>;

export type ToolStyleCommands = Pick<
  EditorShellCommands,
  | "changePenStyle"
  | "changeHighlightStyle"
  | "changeCommentStyle"
  | "changeFreetextStyle"
  | "changeShapeStyle"
  | "changeStampStyle"
>;

export type FloatingToolbarCommands = ToolStyleCommands &
  Pick<EditorShellCommands, "changeTool" | "exitTool" | "changeMode">;
