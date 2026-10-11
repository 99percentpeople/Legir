import type { IAnnotationExporter, IControlExporter } from "../types";
import {
  InkExporter,
  HighlightExporter,
  CommentExporter,
  FreeTextExporter,
  LinkExporter,
  StampExporter,
  ShapeExporter,
} from "./AnnotationExporters";
import {
  TextControlExporter,
  CheckboxControlExporter,
  RadioControlExporter,
  DropdownControlExporter,
  SignatureControlExporter,
} from "./ControlExporters";

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
];
