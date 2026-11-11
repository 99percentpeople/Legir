import { FieldType, type FormField, type Annotation } from "@/types";
import type {
  ControlProperty,
  ControlPropertyKey,
  ControlPropertyValue,
  EditableControl,
} from "./types";

export const isFormControl = (control: EditableControl): control is FormField =>
  "name" in control;
const isText = (control: EditableControl) =>
  control.type === FieldType.TEXT || control.type === "freetext";
const hasFont = (control: EditableControl) =>
  isText(control) ||
  control.type === FieldType.DROPDOWN ||
  control.type === FieldType.BUTTON;
const hasBox = (control: EditableControl) =>
  isFormControl(control) || control.type === "freetext";
const hasColor = (control: EditableControl) =>
  hasFont(control) ||
  ["shape", "ink", "highlight", "comment"].includes(control.type);
const label = (key: string) => `properties.${key}`;

/** Capabilities and effective values shared by the multi-edit panel and store command. */
export const CONTROL_PROPERTIES: readonly ControlProperty[] = [
  {
    key: "fontFamily",
    label: label("font_family"),
    kind: "font",
    supports: hasFont,
    read: (c) =>
      (isFormControl(c) ? c.style?.fontFamily : c.fontFamily) || "Helvetica",
  },
  {
    key: "fontSize",
    label: label("font_size"),
    kind: "number",
    min: 6,
    max: 72,
    supports: hasFont,
    read: (c) => (isFormControl(c) ? c.style?.fontSize : c.size) || 12,
  },
  {
    key: "color",
    label: label("color"),
    kind: "color",
    supports: hasColor,
    read: (c) =>
      (isFormControl(c) ? c.style?.textColor : c.color) ||
      (["highlight", "comment"].includes(c.type) ? "#ffff00" : "#000000"),
  },
  {
    key: "horizontalAlignment",
    label: label("alignment"),
    kind: "choice",
    supports: isText,
    read: (c) => c.horizontalAlignment ?? "left",
    options: ["left", "center", "right"].map((value) => ({
      value,
      label: label(`alignment_options.${value}`),
    })),
  },
  {
    key: "verticalAlignment",
    label: label("vertical_alignment"),
    kind: "choice",
    supports: isText,
    read: (c) =>
      c.verticalAlignment ??
      (isFormControl(c) && !c.multiline ? "middle" : "top"),
    options: ["top", "middle", "bottom"].map((value) => ({
      value,
      label: label(`vertical_alignment_options.${value}`),
    })),
  },
  {
    key: "backgroundColor",
    label: label("background"),
    kind: "color",
    supports: hasBox,
    read: (c) =>
      (isFormControl(c) ? c.style?.backgroundColor : c.backgroundColor) ||
      "#ffffff",
  },
  {
    key: "isTransparent",
    label: label("transparent"),
    kind: "boolean",
    supports: hasBox,
    read: (c) =>
      isFormControl(c) ? !!c.style?.isTransparent : !c.backgroundColor,
  },
  {
    key: "borderColor",
    label: label("border_color"),
    kind: "color",
    supports: hasBox,
    read: (c) =>
      (isFormControl(c) ? c.style?.borderColor : c.borderColor) || "#000000",
  },
  {
    key: "borderWidth",
    label: label("border_width"),
    kind: "number",
    min: 0,
    max: 10,
    supports: hasBox,
    read: (c) =>
      isFormControl(c) ? (c.style?.borderWidth ?? 1) : (c.borderWidth ?? 0),
  },
  {
    key: "required",
    label: label("required"),
    kind: "boolean",
    supports: isFormControl,
    read: (c) => isFormControl(c) && !!c.required,
  },
  {
    key: "readOnly",
    label: label("readonly"),
    kind: "boolean",
    supports: isFormControl,
    read: (c) => isFormControl(c) && !!c.readOnly,
  },
  {
    key: "opacity",
    label: label("opacity"),
    kind: "number",
    min: 0,
    max: 100,
    supports: (c) => !isFormControl(c) && (hasColor(c) || c.type === "stamp"),
    read: (c) =>
      isFormControl(c)
        ? 100
        : Math.round(
            (c.opacity ??
              (c.type === "highlight"
                ? 0.4
                : c.type === "ink" && c.intent === "InkHighlight"
                  ? 0.35
                  : c.type === "stamp"
                    ? 0.9
                    : 1)) * 100,
          ),
  },
  {
    key: "thickness",
    label: label("thickness"),
    kind: "number",
    min: 1,
    max: 20,
    supports: (c) => c.type === "shape" || c.type === "ink",
    read: (c) =>
      isFormControl(c) ? 1 : (c.thickness ?? (c.type === "shape" ? 2 : 1)),
  },
];

export function getCommonControlProperties(controls: EditableControl[]) {
  return controls.length
    ? CONTROL_PROPERTIES.filter((p) => controls.every(p.supports))
    : [];
}
export function getCommonPropertyValue(
  controls: EditableControl[],
  property: ControlProperty,
) {
  const first = controls[0] && property.read(controls[0]);
  return controls.every((c) => Object.is(property.read(c), first))
    ? first
    : undefined;
}
export function isValidControlPropertyValue(
  property: ControlProperty,
  value: ControlPropertyValue,
) {
  switch (property.kind) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= property.min! &&
        value <= property.max!
      );
    case "choice":
      return property.options!.some((option) => option.value === value);
    case "font":
      return typeof value === "string" && value.trim().length > 0;
    case "color":
      return typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
  }
}

/** Patches merge only the requested style member, preserving every other property. */
export function getControlPropertyPatch(
  control: EditableControl,
  key: ControlPropertyKey,
  value: ControlPropertyValue,
): Partial<FormField> | Partial<Annotation> {
  if (isFormControl(control)) {
    switch (key) {
      case "fontFamily":
      case "fontSize":
      case "borderColor":
      case "borderWidth":
      case "isTransparent":
        return { style: { ...control.style, [key]: value } };
      case "color":
        return { style: { ...control.style, textColor: value as string } };
      case "backgroundColor":
        return {
          style: {
            ...control.style,
            backgroundColor: value as string,
            isTransparent: false,
          },
        };
      default:
        return { [key]: value };
    }
  }
  const patch: Partial<Annotation> =
    key === "fontSize"
      ? { size: value as number }
      : key === "isTransparent"
        ? {
            backgroundColor: value
              ? undefined
              : control.backgroundColor || "#ffffff",
          }
        : key === "opacity"
          ? { opacity: (value as number) / 100 }
          : { [key]: value };
  if (control.type === "ink") patch.appearanceStreamContent = undefined;
  return patch;
}
