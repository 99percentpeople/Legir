import type { Annotation, FormField } from "@/types";

export type EditableControl = FormField | Annotation;
export type ControlPropertyValue = string | number | boolean;
export type ControlPropertyKey =
  | "fontFamily"
  | "fontSize"
  | "color"
  | "horizontalAlignment"
  | "verticalAlignment"
  | "backgroundColor"
  | "isTransparent"
  | "borderColor"
  | "borderWidth"
  | "required"
  | "readOnly"
  | "opacity"
  | "thickness";
export interface ControlProperty {
  key: ControlPropertyKey;
  label: string;
  kind: "font" | "number" | "color" | "boolean" | "choice";
  min?: number;
  max?: number;
  options?: readonly { value: string; label: string }[];
  supports: (control: EditableControl) => boolean;
  read: (control: EditableControl) => ControlPropertyValue;
}
