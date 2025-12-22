import React from "react";
import { registry } from "./registry/ControlRegistry";
import { FieldType } from "@/types";

// Workspace control system.
//
// Controls are registered once at app startup (see `src/index.tsx`).
// Rendering is dispatched by `data.type` in `ControlRenderer`.
//
// To add a new Form control:
// - Add a `FieldType` in `src/types.ts`
// - Create a control component under `./form/`
// - Create an optional properties panel under `./properties/`
// - Register it in `registerControls()` below
//
// For PDF import/export support, also add parser/exporter implementations under `services/pdf/...`.

// Lazy load controls
const TextControl = React.lazy(() =>
  import("./form/TextControl").then((module) => ({
    default: module.TextControl,
  })),
);
const CheckboxControl = React.lazy(() =>
  import("./form/CheckboxControl").then((module) => ({
    default: module.CheckboxControl,
  })),
);
const RadioControl = React.lazy(() =>
  import("./form/RadioControl").then((module) => ({
    default: module.RadioControl,
  })),
);
const DropdownControl = React.lazy(() =>
  import("./form/DropdownControl").then((module) => ({
    default: module.DropdownControl,
  })),
);
const SignatureControl = React.lazy(() =>
  import("./form/SignatureControl").then((module) => ({
    default: module.SignatureControl,
  })),
);

const HighlightControl = React.lazy(() =>
  import("./annotation/HighlightControl").then((module) => ({
    default: module.HighlightControl,
  })),
);
const CommentControl = React.lazy(() =>
  import("./annotation/CommentControl").then((module) => ({
    default: module.CommentControl,
  })),
);
const FreetextControl = React.lazy(() =>
  import("./annotation/FreetextControl").then((module) => ({
    default: module.FreetextControl,
  })),
);
const InkControl = React.lazy(() =>
  import("./annotation/InkControl").then((module) => ({
    default: module.InkControl,
  })),
);

// Lazy load properties
const TextProperties = React.lazy(() =>
  import("./properties/TextProperties").then((module) => ({
    default: module.TextProperties,
  })),
);
const CheckboxProperties = React.lazy(() =>
  import("./properties/CheckboxProperties").then((module) => ({
    default: module.CheckboxProperties,
  })),
);
const RadioProperties = React.lazy(() =>
  import("./properties/RadioProperties").then((module) => ({
    default: module.RadioProperties,
  })),
);
const DropdownProperties = React.lazy(() =>
  import("./properties/DropdownProperties").then((module) => ({
    default: module.DropdownProperties,
  })),
);
const SignatureProperties = React.lazy(() =>
  import("./properties/SignatureProperties").then((module) => ({
    default: module.SignatureProperties,
  })),
);
const HighlightProperties = React.lazy(() =>
  import("./properties/HighlightProperties").then((module) => ({
    default: module.HighlightProperties,
  })),
);
const CommentProperties = React.lazy(() =>
  import("./properties/CommentProperties").then((module) => ({
    default: module.CommentProperties,
  })),
);
const FreetextProperties = React.lazy(() =>
  import("./properties/FreetextProperties").then((module) => ({
    default: module.FreetextProperties,
  })),
);
const InkProperties = React.lazy(() =>
  import("./properties/InkProperties").then((module) => ({
    default: module.InkProperties,
  })),
);

export const registerControls = () => {
  registry.register({
    type: FieldType.TEXT,
    component: TextControl,
    propertiesComponent: TextProperties,
    label: "Text Field",
  });
  registry.register({
    type: FieldType.CHECKBOX,
    component: CheckboxControl,
    propertiesComponent: CheckboxProperties,
    label: "Checkbox",
  });
  registry.register({
    type: FieldType.RADIO,
    component: RadioControl,
    propertiesComponent: RadioProperties,
    label: "Radio Button",
  });
  registry.register({
    type: FieldType.DROPDOWN,
    component: DropdownControl,
    propertiesComponent: DropdownProperties,
    label: "Dropdown",
  });
  registry.register({
    type: FieldType.SIGNATURE,
    component: SignatureControl,
    propertiesComponent: SignatureProperties,
    label: "Signature",
  });

  registry.register({
    type: "highlight",
    component: HighlightControl,
    propertiesComponent: HighlightProperties,
    label: "Highlight",
  });
  registry.register({
    type: "comment",
    component: CommentControl,
    propertiesComponent: CommentProperties,
    label: "Comment",
  });
  registry.register({
    type: "freetext",
    component: FreetextControl,
    propertiesComponent: FreetextProperties,
    label: "FreeText",
  });
  registry.register({
    type: "ink",
    component: InkControl,
    propertiesComponent: InkProperties,
    label: "Ink",
  });
};

export * from "./types";
export * from "./registry/ControlRegistry";
export { ControlWrapper } from "./ControlWrapper";
export { ControlRenderer } from "./ControlRenderer";
