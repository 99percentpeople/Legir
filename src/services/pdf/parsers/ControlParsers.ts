import { FormField, FieldType, FieldStyle } from "@/types";
import { DEFAULT_FIELD_STYLE } from "@/constants";
import {
  rgbArrayToHex,
  getFontMap,
  getGlobalDA,
  parseDefaultAppearance,
  getFieldPropertiesFromPdfLib,
} from "@/lib/pdf-helpers";
import { IControlParser, ParserContext } from "../types";

// Shared helper to parse style
const parseFieldStyle = (
  annotation: any,
  pdfDoc: any,
  fontMap: Map<string, string>,
  globalDA: string | undefined,
): { style: FieldStyle; alignment: "left" | "center" | "right" } => {
  let alignment: "left" | "center" | "right" = "left";
  const importedStyle: FieldStyle = { ...DEFAULT_FIELD_STYLE };

  if (annotation.color) {
    const hex = rgbArrayToHex(annotation.color);
    if (hex) importedStyle.borderColor = hex;
  }

  if (annotation.backgroundColor) {
    const hex = rgbArrayToHex(annotation.backgroundColor);
    if (hex) {
      importedStyle.backgroundColor = hex;
      importedStyle.isTransparent = false;
    }
  } else {
    importedStyle.isTransparent = true;
  }

  if (
    annotation.borderStyle &&
    typeof annotation.borderStyle.width === "number"
  ) {
    importedStyle.borderWidth = annotation.borderStyle.width;
  }

  let da = annotation.defaultAppearance || annotation.DA;
  if (pdfDoc && annotation.fieldName) {
    const libProps = getFieldPropertiesFromPdfLib(pdfDoc, annotation.fieldName);
    if (libProps) {
      if (libProps.da) {
        da = libProps.da;
      }
      if (libProps.q !== undefined) {
        if (libProps.q === 1) alignment = "center";
        else if (libProps.q === 2) alignment = "right";
      }
    }
  }

  const finalDa = da || globalDA;

  if (finalDa) {
    const parsed = parseDefaultAppearance(finalDa, fontMap);
    importedStyle.fontFamily = parsed.fontFamily;
    importedStyle.fontSize = parsed.fontSize;
    importedStyle.textColor = parsed.textColor;
  }

  if (alignment === "left" && typeof annotation.textAlignment === "number") {
    if (annotation.textAlignment === 1) alignment = "center";
    else if (annotation.textAlignment === 2) alignment = "right";
  }

  return { style: importedStyle, alignment };
};

export class TextControlParser implements IControlParser {
  async parse(context: ParserContext): Promise<FormField[]> {
    const { pageAnnotations, pageIndex, viewport, pdfDoc } = context;
    const fields: FormField[] = [];

    // Pre-calculate font map and globalDA if needed (or do it per field, simpler logic)
    // For performance, we could pass these in context, but let's stick to the interface.
    let fontMap = new Map<string, string>();
    let globalDA: string | undefined = undefined;
    if (pdfDoc) {
      fontMap = getFontMap(pdfDoc);
      globalDA = getGlobalDA(pdfDoc);
    }

    pageAnnotations.forEach((annotation, index) => {
      if (
        annotation.subtype === "Widget" &&
        annotation.fieldName &&
        annotation.fieldType === "Tx"
      ) {
        const [x1, y1, x2, y2] = annotation.rect;
        const width = x2 - x1;
        const height = y2 - y1;
        const x = x1;
        const y = viewport.height - y2;

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

    let fontMap = new Map<string, string>();
    let globalDA: string | undefined = undefined;
    if (pdfDoc) {
      fontMap = getFontMap(pdfDoc);
      globalDA = getGlobalDA(pdfDoc);
    }

    pageAnnotations.forEach((annotation, index) => {
      if (
        annotation.subtype === "Widget" &&
        annotation.fieldName &&
        annotation.fieldType === "Btn" &&
        annotation.checkBox
      ) {
        const [x1, y1, x2, y2] = annotation.rect;
        const width = x2 - x1;
        const height = y2 - y1;
        const x = x1;
        const y = viewport.height - y2;

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

    let fontMap = new Map<string, string>();
    let globalDA: string | undefined = undefined;
    if (pdfDoc) {
      fontMap = getFontMap(pdfDoc);
      globalDA = getGlobalDA(pdfDoc);
    }

    pageAnnotations.forEach((annotation, index) => {
      if (
        annotation.subtype === "Widget" &&
        annotation.fieldName &&
        annotation.fieldType === "Btn" &&
        annotation.radioButton
      ) {
        const [x1, y1, x2, y2] = annotation.rect;
        const width = x2 - x1;
        const height = y2 - y1;
        const x = x1;
        const y = viewport.height - y2;

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

    let fontMap = new Map<string, string>();
    let globalDA: string | undefined = undefined;
    if (pdfDoc) {
      fontMap = getFontMap(pdfDoc);
      globalDA = getGlobalDA(pdfDoc);
    }

    pageAnnotations.forEach((annotation, index) => {
      if (
        annotation.subtype === "Widget" &&
        annotation.fieldName &&
        annotation.fieldType === "Ch"
      ) {
        const [x1, y1, x2, y2] = annotation.rect;
        const width = x2 - x1;
        const height = y2 - y1;
        const x = x1;
        const y = viewport.height - y2;

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

    let fontMap = new Map<string, string>();
    let globalDA: string | undefined = undefined;
    if (pdfDoc) {
      fontMap = getFontMap(pdfDoc);
      globalDA = getGlobalDA(pdfDoc);
    }

    pageAnnotations.forEach((annotation, index) => {
      if (
        annotation.subtype === "Widget" &&
        annotation.fieldName &&
        annotation.fieldType === "Sig"
      ) {
        const [x1, y1, x2, y2] = annotation.rect;
        const width = x2 - x1;
        const height = y2 - y1;
        const x = x1;
        const y = viewport.height - y2;

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
