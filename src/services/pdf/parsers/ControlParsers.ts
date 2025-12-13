import { FormField, FieldType } from "@/types";
import { IControlParser, ParserContext } from "../types";
import {
  getStyleParsingResources,
  parseFieldStyle,
} from "../lib/control-parsing";
import { pdfJsWidgetRectToUiRect } from "../lib/coords";
import { pdfDebug } from "../lib/debug";

const getViewportSummary = (viewport: any) => {
  try {
    return {
      width: viewport?.width,
      height: viewport?.height,
      scale: viewport?.scale,
      rotation: viewport?.rotation,
      transform: viewport?.transform,
      offsetX: viewport?.offsetX,
      offsetY: viewport?.offsetY,
    };
  } catch {
    return {};
  }
};

export class TextControlParser implements IControlParser {
  async parse(context: ParserContext): Promise<FormField[]> {
    const { pageAnnotations, pageIndex, viewport, pdfDoc } = context;
    const fields: FormField[] = [];

    const { fontMap, globalDA } = getStyleParsingResources(context);

    pageAnnotations.forEach((annotation, index) => {
      if (
        annotation.subtype === "Widget" &&
        annotation.fieldName &&
        annotation.fieldType === "Tx"
      ) {
        const { x, y, width, height } = pdfJsWidgetRectToUiRect(
          annotation.rect,
          viewport,
        );

        pdfDebug("import:controls", "widget_parsed", {
          pageIndex,
          index,
          fieldName: annotation.fieldName,
          fieldType: annotation.fieldType,
          rect: annotation.rect,
          uiRect: { x, y, width, height },
          viewport: getViewportSummary(viewport),
        });

        const { style, alignment } = parseFieldStyle(
          annotation,
          pdfDoc,
          fontMap,
          globalDA,
        );

        fields.push({
          id: `imported_${pageIndex + 1}_${index}_${annotation.fieldName}`,
          pageIndex: pageIndex,
          type: FieldType.TEXT,
          name: annotation.fieldName,
          rect: { x, y, width, height },
          required: !!(annotation.fieldFlags & 2),
          style: style,
          value:
            typeof annotation.fieldValue === "string"
              ? annotation.fieldValue
              : undefined,
          alignment: alignment,
          multiline: !!(annotation.fieldFlags & 4096),
          toolTip: annotation.alternativeText || undefined,
        });
      }
    });

    return fields;
  }
}

export class CheckboxControlParser implements IControlParser {
  async parse(context: ParserContext): Promise<FormField[]> {
    const { pageAnnotations, pageIndex, viewport, pdfDoc } = context;
    const fields: FormField[] = [];

    const { fontMap, globalDA } = getStyleParsingResources(context);

    pageAnnotations.forEach((annotation, index) => {
      if (
        annotation.subtype === "Widget" &&
        annotation.fieldName &&
        annotation.fieldType === "Btn" &&
        annotation.checkBox
      ) {
        const { x, y, width, height } = pdfJsWidgetRectToUiRect(
          annotation.rect,
          viewport,
        );

        pdfDebug("import:controls", "widget_parsed", {
          pageIndex,
          index,
          fieldName: annotation.fieldName,
          fieldType: annotation.fieldType,
          rect: annotation.rect,
          uiRect: { x, y, width, height },
          viewport: getViewportSummary(viewport),
        });

        const { style } = parseFieldStyle(
          annotation,
          pdfDoc,
          fontMap,
          globalDA,
        );
        const isChecked =
          annotation.fieldValue && annotation.fieldValue !== "Off";

        fields.push({
          id: `imported_${pageIndex + 1}_${index}_${annotation.fieldName}`,
          pageIndex: pageIndex,
          type: FieldType.CHECKBOX,
          name: annotation.fieldName,
          rect: { x, y, width, height },
          required: !!(annotation.fieldFlags & 2),
          style: style,
          isChecked: isChecked,
          exportValue: annotation.fieldValue, // Might need refinement
          toolTip: annotation.alternativeText || undefined,
        });
      }
    });
    return fields;
  }
}

export class RadioControlParser implements IControlParser {
  async parse(context: ParserContext): Promise<FormField[]> {
    const { pageAnnotations, pageIndex, viewport, pdfDoc } = context;
    const fields: FormField[] = [];

    const { fontMap, globalDA } = getStyleParsingResources(context);

    pageAnnotations.forEach((annotation, index) => {
      if (
        annotation.subtype === "Widget" &&
        annotation.fieldName &&
        annotation.fieldType === "Btn" &&
        annotation.radioButton
      ) {
        const { x, y, width, height } = pdfJsWidgetRectToUiRect(
          annotation.rect,
          viewport,
        );

        pdfDebug("import:controls", "widget_parsed", {
          pageIndex,
          index,
          fieldName: annotation.fieldName,
          fieldType: annotation.fieldType,
          rect: annotation.rect,
          uiRect: { x, y, width, height },
          viewport: getViewportSummary(viewport),
        });

        const { style } = parseFieldStyle(
          annotation,
          pdfDoc,
          fontMap,
          globalDA,
        );
        const radioValue = annotation.buttonValue;
        const isChecked = annotation.fieldValue === radioValue;

        fields.push({
          id: `imported_${pageIndex + 1}_${index}_${annotation.fieldName}`,
          pageIndex: pageIndex,
          type: FieldType.RADIO,
          name: annotation.fieldName,
          rect: { x, y, width, height },
          required: !!(annotation.fieldFlags & 2),
          style: style,
          isChecked: isChecked,
          radioValue: radioValue,
          exportValue: radioValue,
          toolTip: annotation.alternativeText || undefined,
        });
      }
    });
    return fields;
  }
}

export class DropdownControlParser implements IControlParser {
  async parse(context: ParserContext): Promise<FormField[]> {
    const { pageAnnotations, pageIndex, viewport, pdfDoc } = context;
    const fields: FormField[] = [];

    const { fontMap, globalDA } = getStyleParsingResources(context);

    pageAnnotations.forEach((annotation, index) => {
      if (
        annotation.subtype === "Widget" &&
        annotation.fieldName &&
        annotation.fieldType === "Ch"
      ) {
        const { x, y, width, height } = pdfJsWidgetRectToUiRect(
          annotation.rect,
          viewport,
        );

        pdfDebug("import:controls", "widget_parsed", {
          pageIndex,
          index,
          fieldName: annotation.fieldName,
          fieldType: annotation.fieldType,
          rect: annotation.rect,
          uiRect: { x, y, width, height },
          viewport: getViewportSummary(viewport),
        });

        const { style, alignment } = parseFieldStyle(
          annotation,
          pdfDoc,
          fontMap,
          globalDA,
        );

        let options: string[] | undefined = undefined;
        if (Array.isArray(annotation.options)) {
          options = annotation.options.map((opt: any) =>
            typeof opt === "string" ? opt : opt.display || opt.exportValue,
          );
        }

        const isMultiSelect = !!(
          annotation.fieldFlags && annotation.fieldFlags & 2097152
        );

        fields.push({
          id: `imported_${pageIndex + 1}_${index}_${annotation.fieldName}`,
          pageIndex: pageIndex,
          type: FieldType.DROPDOWN,
          name: annotation.fieldName,
          rect: { x, y, width, height },
          required: !!(annotation.fieldFlags & 2),
          style: style,
          value: Array.isArray(annotation.fieldValue)
            ? annotation.fieldValue.join("\n")
            : typeof annotation.fieldValue === "string"
              ? annotation.fieldValue
              : undefined,
          options: options,
          isMultiSelect: isMultiSelect,
          alignment: alignment,
          toolTip: annotation.alternativeText || undefined,
        });
      }
    });
    return fields;
  }
}

export class SignatureControlParser implements IControlParser {
  async parse(context: ParserContext): Promise<FormField[]> {
    const { pageAnnotations, pageIndex, viewport, pdfDoc } = context;
    const fields: FormField[] = [];

    const { fontMap, globalDA } = getStyleParsingResources(context);

    pageAnnotations.forEach((annotation, index) => {
      if (
        annotation.subtype === "Widget" &&
        annotation.fieldName &&
        annotation.fieldType === "Sig"
      ) {
        const { x, y, width, height } = pdfJsWidgetRectToUiRect(
          annotation.rect,
          viewport,
        );

        pdfDebug("import:controls", "widget_parsed", {
          pageIndex,
          index,
          fieldName: annotation.fieldName,
          fieldType: annotation.fieldType,
          rect: annotation.rect,
          uiRect: { x, y, width, height },
          viewport: getViewportSummary(viewport),
        });

        const { style } = parseFieldStyle(
          annotation,
          pdfDoc,
          fontMap,
          globalDA,
        );

        fields.push({
          id: `imported_${pageIndex + 1}_${index}_${annotation.fieldName}`,
          pageIndex: pageIndex,
          type: FieldType.SIGNATURE,
          name: annotation.fieldName,
          rect: { x, y, width, height },
          required: !!(annotation.fieldFlags & 2),
          style: style,
          toolTip: annotation.alternativeText || undefined,
        });
      }
    });
    return fields;
  }
}
