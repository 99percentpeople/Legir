import { ButtonControlExporter } from "./ButtonControlExporter.js";
import type { IAnnotationExporter, IControlExporter } from "../types.js";
import {
  InkExporter,
  HighlightExporter,
  CommentExporter,
  FreeTextExporter,
  LinkExporter,
  StampExporter,
  ShapeExporter,
} from "./AnnotationExporters.js";
import {
  TextControlExporter,
  CheckboxControlExporter,
  RadioControlExporter,
  DropdownControlExporter,
  SignatureControlExporter,
} from "./ControlExporters.js";

export const annotationExporters: IAnnotationExporter[] = [
  new InkExporter(),
  new HighlightExporter(),
  new CommentExporter(),
  new FreeTextExporter(),
  new LinkExporter(),
  new StampExporter(),
  new ShapeExporter(),
];

export const controlExporters: IControlExporter[] = [
  new TextControlExporter(),
  new CheckboxControlExporter(),
  new RadioControlExporter(),
  new DropdownControlExporter(),
  new SignatureControlExporter(),
  new ButtonControlExporter(),
];
