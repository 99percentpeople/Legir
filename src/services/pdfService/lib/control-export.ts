import type { FormField } from "@/types";
import type { PDFPage } from "@cantoo/pdf-lib";
import type * as pdfjsLib from "pdfjs-dist";
import { hexToPdfColor } from "./colors";
import { uiRectToPdfBounds } from "./coords";

export const getCommonControlExportOpts = (
  field: FormField,
  page: PDFPage,
  viewport?: pdfjsLib.PageViewport,
) => {
  const b = uiRectToPdfBounds(page, field.rect, viewport);
  const bw = field.style?.borderWidth ?? 1;
  const hasBorder = bw > 0;
  return {
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    borderColor: hasBorder
      ? hexToPdfColor(field.style?.borderColor)
      : undefined,
    backgroundColor: field.style?.isTransparent
      ? undefined
      : hexToPdfColor(field.style?.backgroundColor),
    borderWidth: hasBorder ? bw : 0,
    textColor: hexToPdfColor(field.style?.textColor),
  };
};
