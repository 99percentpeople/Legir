import type { EditorState, PenStyle, Tool } from "@/types";
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

export interface ToolStyleCommands {
  changePenStyle: (style: Partial<PenStyle>) => void;
  changeHighlightStyle: (style: Partial<PenStyle>) => void;
  changeCommentStyle: (style: { color: string }) => void;
  changeFreetextStyle: (style: { color: string }) => void;
  changeShapeStyle: (
    style: Partial<NonNullable<EditorState["shapeStyle"]>>,
  ) => void;
  changeStampStyle: (
    style: Partial<NonNullable<EditorState["stampStyle"]>>,
  ) => void;
}

export interface FloatingToolbarCommands extends ToolStyleCommands {
  changeTool: (tool: Tool) => void;
  exitTool: () => void;
  changeMode: (mode: EditorState["mode"]) => void;
}
