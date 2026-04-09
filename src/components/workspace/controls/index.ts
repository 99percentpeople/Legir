import React from "react";
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

type LazyWithPreload<T extends UnsafeComponent> =
  React.LazyExoticComponent<T> & {
    preload?: () => Promise<{ default: T }>;
  };

const lazyWithPreload = <T extends UnsafeComponent>(
  loader: () => Promise<{ default: T }>,
) => {
  const Comp = React.lazy(loader) as LazyWithPreload<T>;
  Comp.preload = loader;
  return Comp;
};

type ControlConfig = {
  type: FieldType | string;
  component: LazyWithPreload<UnsafeComponent>;
  propertiesComponent: LazyWithPreload<UnsafeComponent>;
  label: string;
  supportsGeometrySizeEdit?:
    | boolean
    | ((data: FormField | Annotation) => boolean);
};

const CONTROL_CONFIGS: ControlConfig[] = [
  {
    type: FieldType.TEXT,
    component: lazyWithPreload(() =>
      import("./form/TextControl").then((module) => ({
        default: module.TextControl,
      })),
    ),
    propertiesComponent: lazyWithPreload(() =>
      import("./properties/TextProperties").then((module) => ({
        default: module.TextProperties,
      })),
    ),
    label: "Text Field",
    supportsGeometrySizeEdit: true,
  },
  {
    type: FieldType.CHECKBOX,
    component: lazyWithPreload(() =>
      import("./form/CheckboxControl").then((module) => ({
        default: module.CheckboxControl,
      })),
    ),
    propertiesComponent: lazyWithPreload(() =>
      import("./properties/CheckboxProperties").then((module) => ({
        default: module.CheckboxProperties,
      })),
    ),
    label: "Checkbox",
    supportsGeometrySizeEdit: true,
  },
  {
    type: FieldType.RADIO,
    component: lazyWithPreload(() =>
      import("./form/RadioControl").then((module) => ({
        default: module.RadioControl,
      })),
    ),
    propertiesComponent: lazyWithPreload(() =>
      import("./properties/RadioProperties").then((module) => ({
        default: module.RadioProperties,
      })),
    ),
    label: "Radio Button",
    supportsGeometrySizeEdit: true,
  },
  {
    type: FieldType.DROPDOWN,
    component: lazyWithPreload(() =>
      import("./form/DropdownControl").then((module) => ({
        default: module.DropdownControl,
      })),
    ),
    propertiesComponent: lazyWithPreload(() =>
      import("./properties/DropdownProperties").then((module) => ({
        default: module.DropdownProperties,
      })),
    ),
    label: "Dropdown",
    supportsGeometrySizeEdit: true,
  },
  {
    type: FieldType.SIGNATURE,
    component: lazyWithPreload(() =>
      import("./form/SignatureControl").then((module) => ({
        default: module.SignatureControl,
      })),
    ),
    propertiesComponent: lazyWithPreload(() =>
      import("./properties/SignatureProperties").then((module) => ({
        default: module.SignatureProperties,
      })),
    ),
    label: "Signature",
    supportsGeometrySizeEdit: true,
  },
  {
    type: "highlight",
    component: lazyWithPreload(() =>
      import("./annotation/HighlightControl").then((module) => ({
        default: module.HighlightControl,
      })),
    ),
    propertiesComponent: lazyWithPreload(() =>
      import("./properties/HighlightProperties").then((module) => ({
        default: module.HighlightProperties,
      })),
    ),
    label: "Highlight",
    supportsGeometrySizeEdit: false,
  },
  {
    type: "comment",
    component: lazyWithPreload(() =>
      import("./annotation/CommentControl").then((module) => ({
        default: module.CommentControl,
      })),
    ),
    propertiesComponent: lazyWithPreload(() =>
      import("./properties/CommentProperties").then((module) => ({
        default: module.CommentProperties,
      })),
    ),
    label: "Comment",
    supportsGeometrySizeEdit: false,
  },
  {
    type: "link",
    component: lazyWithPreload(() =>
      import("./annotation/LinkControl").then((module) => ({
        default: module.LinkControl,
      })),
    ),
    propertiesComponent: lazyWithPreload(() =>
      import("./properties/LinkProperties").then((module) => ({
        default: module.LinkProperties,
      })),
    ),
    label: "Link",
    supportsGeometrySizeEdit: false,
  },
  {
    type: "freetext",
    component: lazyWithPreload(() =>
      import("./annotation/FreetextControl").then((module) => ({
        default: module.FreetextControl,
      })),
    ),
    propertiesComponent: lazyWithPreload(() =>
      import("./properties/FreetextProperties").then((module) => ({
        default: module.FreetextProperties,
      })),
    ),
    label: "FreeText",
    supportsGeometrySizeEdit: true,
  },
  {
    type: "ink",
    component: lazyWithPreload(() =>
      import("./annotation/InkControl").then((module) => ({
        default: module.InkControl,
      })),
    ),
    propertiesComponent: lazyWithPreload(() =>
      import("./properties/InkProperties").then((module) => ({
        default: module.InkProperties,
      })),
    ),
    label: "Ink",
    supportsGeometrySizeEdit: false,
  },
  {
    type: "stamp",
    component: lazyWithPreload(() =>
      import("./annotation/StampControl").then((module) => ({
        default: module.StampControl,
      })),
    ),
    propertiesComponent: lazyWithPreload(() =>
      import("./properties/StampProperties").then((module) => ({
        default: module.StampProperties,
      })),
    ),
    label: "Stamp",
    supportsGeometrySizeEdit: true,
  },
  {
    type: "shape",
    component: lazyWithPreload(() =>
      import("./annotation/ShapeControl").then((module) => ({
        default: module.ShapeControl,
      })),
    ),
    propertiesComponent: lazyWithPreload(() =>
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

type PreloadableLazyComponent = {
  _init?: (payload: unknown) => void;
  _payload?: unknown;
};

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

const warmLazy = async (lazyComp: unknown) => {
  if (!lazyComp || typeof lazyComp !== "object") return;
  const preloadableLazy = lazyComp as PreloadableLazyComponent;
  if (typeof preloadableLazy._init !== "function") return;
  try {
    preloadableLazy._init(preloadableLazy._payload);
  } catch (thrown: unknown) {
    if (isPromiseLike(thrown)) {
      try {
        await thrown;
      } catch {
        return;
      }
      try {
        preloadableLazy._init(preloadableLazy._payload);
      } catch {
        return;
      }
    }
  }
};

export const preloadControls = () => {
  if (controlsPreloaded) return;
  controlsPreloaded = true;

  const lazyList = CONTROL_CONFIGS.flatMap((c) => [
    c.component,
    c.propertiesComponent,
  ]);

  for (const c of lazyList) void c.preload?.();
  void Promise.all(lazyList.map((c) => warmLazy(c)));
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
