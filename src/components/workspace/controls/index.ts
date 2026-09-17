import type React from "react";
import { preload, type PreloadableLazyComponent } from "@/utils/preload";
import { registry } from "./registry/ControlRegistry";
import { Annotation, FieldType, FormField } from "@/types";

// Workspace control system.
//
// Controls are registered/preloaded once when the Workspace module is loaded.
// Rendering is dispatched by `data.type` in `ControlRenderer`.
//
// To add a new Form control:
// - Add a `FieldType` in `src/types.ts`
// - Create a control component under `./form/`
// - Create an optional properties panel under `./properties/`
// - Register it in `registerControls()` below
//
// For PDF import/export support, also add parser/exporter implementations under `services/pdf/...`.

type UnsafeComponent = React.ComponentType<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type ControlConfig = {
  type: FieldType | string;
  component: PreloadableLazyComponent<UnsafeComponent>;
  propertiesComponent: PreloadableLazyComponent<UnsafeComponent>;
  label: string;
  supportsGeometrySizeEdit?:
    | boolean
    | ((data: FormField | Annotation) => boolean);
};

const CONTROL_CONFIGS: ControlConfig[] = [
  {
    type: FieldType.TEXT,
    component: preload(() =>
      import("./form/TextControl").then((module) => ({
        default: module.TextControl,
      })),
    ),
    propertiesComponent: preload(() =>
      import("./properties/TextProperties").then((module) => ({
        default: module.TextProperties,
      })),
    ),
    label: "Text Field",
    supportsGeometrySizeEdit: true,
  },
  {
    type: FieldType.CHECKBOX,
    component: preload(() =>
      import("./form/CheckboxControl").then((module) => ({
        default: module.CheckboxControl,
      })),
    ),
    propertiesComponent: preload(() =>
      import("./properties/CheckboxProperties").then((module) => ({
        default: module.CheckboxProperties,
      })),
    ),
    label: "Checkbox",
    supportsGeometrySizeEdit: true,
  },
  {
    type: FieldType.RADIO,
    component: preload(() =>
      import("./form/RadioControl").then((module) => ({
        default: module.RadioControl,
      })),
    ),
    propertiesComponent: preload(() =>
      import("./properties/RadioProperties").then((module) => ({
        default: module.RadioProperties,
      })),
    ),
    label: "Radio Button",
    supportsGeometrySizeEdit: true,
  },
  {
    type: FieldType.DROPDOWN,
    component: preload(() =>
      import("./form/DropdownControl").then((module) => ({
        default: module.DropdownControl,
      })),
    ),
    propertiesComponent: preload(() =>
      import("./properties/DropdownProperties").then((module) => ({
        default: module.DropdownProperties,
      })),
    ),
    label: "Dropdown",
    supportsGeometrySizeEdit: true,
  },
  {
    type: FieldType.SIGNATURE,
    component: preload(() =>
      import("./form/SignatureControl").then((module) => ({
        default: module.SignatureControl,
      })),
    ),
    propertiesComponent: preload(() =>
      import("./properties/SignatureProperties").then((module) => ({
        default: module.SignatureProperties,
      })),
    ),
    label: "Signature",
    supportsGeometrySizeEdit: true,
  },
  {
    type: "highlight",
    component: preload(() =>
      import("./annotation/HighlightControl").then((module) => ({
        default: module.HighlightControl,
      })),
    ),
    propertiesComponent: preload(() =>
      import("./properties/HighlightProperties").then((module) => ({
        default: module.HighlightProperties,
      })),
    ),
    label: "Highlight",
    supportsGeometrySizeEdit: false,
  },
  {
    type: "comment",
    component: preload(() =>
      import("./annotation/CommentControl").then((module) => ({
        default: module.CommentControl,
      })),
    ),
    propertiesComponent: preload(() =>
      import("./properties/CommentProperties").then((module) => ({
        default: module.CommentProperties,
      })),
    ),
    label: "Comment",
    supportsGeometrySizeEdit: false,
  },
  {
    type: "link",
    component: preload(() =>
      import("./annotation/LinkControl").then((module) => ({
        default: module.LinkControl,
      })),
    ),
    propertiesComponent: preload(() =>
      import("./properties/LinkProperties").then((module) => ({
        default: module.LinkProperties,
      })),
    ),
    label: "Link",
    supportsGeometrySizeEdit: false,
  },
  {
    type: "freetext",
    component: preload(() =>
      import("./annotation/FreetextControl").then((module) => ({
        default: module.FreetextControl,
      })),
    ),
    propertiesComponent: preload(() =>
      import("./properties/FreetextProperties").then((module) => ({
        default: module.FreetextProperties,
      })),
    ),
    label: "FreeText",
    supportsGeometrySizeEdit: true,
  },
  {
    type: "ink",
    component: preload(() =>
      import("./annotation/InkControl").then((module) => ({
        default: module.InkControl,
      })),
    ),
    propertiesComponent: preload(() =>
      import("./properties/InkProperties").then((module) => ({
        default: module.InkProperties,
      })),
    ),
    label: "Ink",
    supportsGeometrySizeEdit: false,
  },
  {
    type: "stamp",
    component: preload(() =>
      import("./annotation/StampControl").then((module) => ({
        default: module.StampControl,
      })),
    ),
    propertiesComponent: preload(() =>
      import("./properties/StampProperties").then((module) => ({
        default: module.StampProperties,
      })),
    ),
    label: "Stamp",
    supportsGeometrySizeEdit: true,
  },
  {
    type: "shape",
    component: preload(() =>
      import("./annotation/ShapeControl").then((module) => ({
        default: module.ShapeControl,
      })),
    ),
    propertiesComponent: preload(() =>
      import("./properties/ShapeProperties").then((module) => ({
        default: module.ShapeProperties,
      })),
    ),
    label: "Shape",
    supportsGeometrySizeEdit: (data: FormField | Annotation) =>
      data.type === "shape" &&
      (data.shapeType === "square" ||
        data.shapeType === "circle" ||
        data.shapeType === "cloud"),
  },
];

let controlsPreloaded = false;

export const preloadControls = () => {
  if (controlsPreloaded) return;
  controlsPreloaded = true;

  for (const component of CONTROL_CONFIGS.flatMap((config) => [
    config.component,
    config.propertiesComponent,
  ])) {
    void component.preload();
  }
};

let controlsRegistered = false;

export const registerControls = () => {
  if (controlsRegistered) return;
  controlsRegistered = true;

  for (const config of CONTROL_CONFIGS) {
    registry.register(config);
  }
};

export * from "./types";
export * from "./registry/ControlRegistry";
export { ControlWrapper } from "./ControlWrapper";
export { ControlRenderer } from "./ControlRenderer";
