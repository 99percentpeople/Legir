import React from "react";
import { registry } from "./registry/ControlRegistry";
import { FieldType } from "@/types";

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

type LazyWithPreload<T extends React.ComponentType<any>> =
  React.LazyExoticComponent<T> & {
    preload?: () => Promise<{ default: T }>;
  };

const lazyWithPreload = <T extends React.ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
) => {
  const Comp = React.lazy(loader) as LazyWithPreload<T>;
  Comp.preload = loader;
  return Comp;
};

type ControlConfig = {
  type: FieldType | string;
  component: LazyWithPreload<React.ComponentType<any>>;
  propertiesComponent: LazyWithPreload<React.ComponentType<any>>;
  label: string;
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
  },
];

let controlsPreloaded = false;

const warmLazy = async (lazyComp: any) => {
  if (!lazyComp || typeof lazyComp._init !== "function") return;
  try {
    lazyComp._init(lazyComp._payload);
  } catch (thrown: any) {
    if (thrown && typeof thrown.then === "function") {
      try {
        await thrown;
      } catch {
        return;
      }
      try {
        lazyComp._init(lazyComp._payload);
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
