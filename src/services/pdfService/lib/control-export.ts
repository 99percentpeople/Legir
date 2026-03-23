import type { FormField } from "@/types";
import type { PDFPage } from "@cantoo/pdf-lib";
import type { ViewportLike } from "../types";
import { hexToPdfColor } from "./colors";
import { uiRectToPdfBounds } from "./coords";
import { getWidgetRotationFromControlRotation } from "@/lib/controlRotation";

export const getCommonControlExportOpts = (
  field: FormField,
  page: PDFPage,
  viewport?: ViewportLike,
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

export const applyWidgetExportRotation = (
  widget:
    | {
        getOrCreateAppearanceCharacteristics: () => {
          setRotation: (rotation: number) => void;
        };
      }
    | undefined,
  page: PDFPage,
  fieldRotationDeg?: number,
) => {
  if (!widget) return 0;

  const widgetRotation = getWidgetRotationFromControlRotation(
    page.getRotation().angle,
    fieldRotationDeg ?? 0,
  );
  if (widgetRotation === 0) return 0;

  widget.getOrCreateAppearanceCharacteristics().setRotation(widgetRotation);
  return widgetRotation;
};
