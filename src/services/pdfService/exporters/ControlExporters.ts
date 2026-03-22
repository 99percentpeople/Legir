import {
  PDFForm,
  PDFName,
  PDFString,
  TextAlignment,
  type PDFFont,
} from "@cantoo/pdf-lib";
import { FormField, FieldType } from "@/types";
import { PDF_CUSTOM_KEYS } from "@/constants";
import { IControlExporter, ViewportLike } from "../types";
import { containsNonAscii, isExplicitCjkFontSelection } from "../lib/text";
import { pickCjkFontFromMap } from "../lib/font-selection";
import { getCommonControlExportOpts } from "../lib/control-export";

export class TextControlExporter implements IControlExporter {
  shouldExport(field: FormField): boolean {
    return field.type === FieldType.TEXT;
  }

  save(
    form: PDFForm,
    field: FormField,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
  ): void {
    const page = form.doc.getPage(field.pageIndex);
    const commonOpts = getCommonControlExportOpts(field, page, viewport);

    // Resolve font
    let fieldFont = fontMap?.get("Helvetica"); // Default
    if (field.style?.fontFamily && fontMap?.has(field.style.fontFamily)) {
      fieldFont = fontMap.get(field.style.fontFamily);
    }

    const selectedFamily = field.style?.fontFamily;
    const isSelectedNonStandardEmbedded =
      !!selectedFamily &&
      !!fontMap?.has(selectedFamily) &&
      selectedFamily !== "Helvetica" &&
      selectedFamily !== "Times Roman" &&
      selectedFamily !== "Courier";

    const selectedCanEncodeValue = (() => {
      if (!isSelectedNonStandardEmbedded) return false;
      if (!fieldFont) return false;
      try {
        if (typeof field.value !== "string") return false;
        const original = field.value;
        let sanitized = "";
        for (let i = 0; i < original.length; i++) {
          const ch = original[i];
          sanitized += ch.charCodeAt(0) <= 0x7f ? ch : "?";
        }

        const rawEncoded = fieldFont.encodeText(original).toString();
        const sanitizedEncoded = fieldFont.encodeText(sanitized).toString();
        return rawEncoded !== sanitizedEncoded;
      } catch {
        return false;
      }
    })();

    if (
      field.value &&
      containsNonAscii(field.value) &&
      !isExplicitCjkFontSelection(field.style?.fontFamily) &&
      !(isSelectedNonStandardEmbedded && selectedCanEncodeValue)
    ) {
      const cjk = pickCjkFontFromMap(fontMap, field.style?.fontFamily);
      if (cjk) fieldFont = cjk;
    }

    let tf;
    try {
      tf = form.getTextField(field.name);
    } catch {
      tf = form.createTextField(field.name);
    }

    tf.addToPage(page, { ...commonOpts, font: fieldFont });

    if (field.value) {
      tf.setText(field.value);
    }
    if (field.toolTip) {
      tf.acroField.dict.set(PDFName.of("TU"), PDFString.of(field.toolTip));
    } else {
      tf.acroField.dict.delete(PDFName.of("TU"));
    }

    if (field.placeholder) {
      tf.acroField.dict.set(
        PDFName.of(PDF_CUSTOM_KEYS.placeholder),
        PDFString.of(field.placeholder),
      );
    } else {
      tf.acroField.dict.delete(PDFName.of(PDF_CUSTOM_KEYS.placeholder));
    }

    if (field.style?.fontSize) tf.setFontSize(field.style.fontSize);

    if (field.alignment === "center") tf.setAlignment(TextAlignment.Center);
    else if (field.alignment === "right") tf.setAlignment(TextAlignment.Right);

    if (field.multiline) tf.enableMultiline();

    if (fieldFont) {
      try {
        tf.updateAppearances(fieldFont);
      } catch (e) {
        console.warn("Failed to update text field appearances", e);
      }
    }
  }
}

export class CheckboxControlExporter implements IControlExporter {
  shouldExport(field: FormField): boolean {
    return field.type === FieldType.CHECKBOX;
  }

  save(
    form: PDFForm,
    field: FormField,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
  ): void {
    const page = form.doc.getPage(field.pageIndex);
    const commonOpts = getCommonControlExportOpts(field, page, viewport);

    let cb;
    try {
      cb = form.getCheckBox(field.name);
    } catch {
      cb = form.createCheckBox(field.name);
    }

    cb.addToPage(page, commonOpts);
    if (field.isChecked) cb.check();
    else cb.uncheck();

    if (field.toolTip) {
      cb.acroField.dict.set(PDFName.of("TU"), PDFString.of(field.toolTip));
    }
  }
}

export class DropdownControlExporter implements IControlExporter {
  shouldExport(field: FormField): boolean {
    return field.type === FieldType.DROPDOWN;
  }

  save(
    form: PDFForm,
    field: FormField,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
  ): void {
    const page = form.doc.getPage(field.pageIndex);
    const commonOpts = getCommonControlExportOpts(field, page, viewport);

    // Resolve font
    let fieldFont = fontMap?.get("Helvetica");
    if (field.style?.fontFamily && fontMap?.has(field.style.fontFamily)) {
      fieldFont = fontMap.get(field.style.fontFamily);
    }

    const selectedFamily = field.style?.fontFamily;
    const isSelectedNonStandardEmbedded =
      !!selectedFamily &&
      !!fontMap?.has(selectedFamily) &&
      selectedFamily !== "Helvetica" &&
      selectedFamily !== "Times Roman" &&
      selectedFamily !== "Courier";

    const selectedCanEncodeValue = (() => {
      if (!isSelectedNonStandardEmbedded) return false;
      if (!fieldFont) return false;
      try {
        if (typeof field.value !== "string") return false;
        const original = field.value;
        let sanitized = "";
        for (let i = 0; i < original.length; i++) {
          const ch = original[i];
          sanitized += ch.charCodeAt(0) <= 0x7f ? ch : "?";
        }

        const rawEncoded = fieldFont.encodeText(original).toString();
        const sanitizedEncoded = fieldFont.encodeText(sanitized).toString();
        return rawEncoded !== sanitizedEncoded;
      } catch {
        return false;
      }
    })();
    if (
      field.value &&
      containsNonAscii(field.value) &&
      !isExplicitCjkFontSelection(field.style?.fontFamily) &&
      !selectedCanEncodeValue
    ) {
      const cjk = pickCjkFontFromMap(fontMap, field.style?.fontFamily);
      if (cjk) fieldFont = cjk;
    }

    if (field.isMultiSelect) {
      let ol;
      try {
        ol = form.getOptionList(field.name);
      } catch {
        ol = form.createOptionList(field.name);
      }

      ol.addToPage(page, { ...commonOpts, font: fieldFont });
      if (field.options) ol.setOptions(field.options);

      ol.enableMultiselect();

      if (field.value) {
        const vals = field.value.split("\n").filter((v) => v && v !== "");
        try {
          ol.select(vals);
        } catch (e) {
          console.warn("Failed to select values for option list", e);
        }
      }

      if (field.toolTip) {
        ol.acroField.dict.set(PDFName.of("TU"), PDFString.of(field.toolTip));
      }

      if (field.style?.fontSize) ol.setFontSize(field.style.fontSize);
      if (fieldFont) {
        try {
          ol.updateAppearances(fieldFont);
        } catch (e) {
          console.warn("Failed to update option list appearances", e);
        }
      }
    } else {
      let dd;
      try {
        dd = form.getDropdown(field.name);
      } catch {
        dd = form.createDropdown(field.name);
      }

      dd.addToPage(page, { ...commonOpts, font: fieldFont });
      if (field.options) dd.setOptions(field.options);
      if (field.allowCustomValue) dd.enableEditing();

      if (field.value) {
        try {
          dd.select(field.value);
        } catch (e) {
          console.warn("Failed to select value for dropdown", e);
        }
      }

      if (field.toolTip) {
        dd.acroField.dict.set(PDFName.of("TU"), PDFString.of(field.toolTip));
      }

      if (field.style?.fontSize) dd.setFontSize(field.style.fontSize);
      if (fieldFont) {
        try {
          dd.updateAppearances(fieldFont);
        } catch (e) {
          console.warn("Failed to update dropdown appearances", e);
        }
      }
    }
  }
}

export class RadioControlExporter implements IControlExporter {
  shouldExport(field: FormField): boolean {
    return field.type === FieldType.RADIO;
  }

  save(
    form: PDFForm,
    field: FormField,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
  ): void {
    const page = form.doc.getPage(field.pageIndex);
    const commonOpts = getCommonControlExportOpts(field, page, viewport);

    let rg;
    try {
      rg = form.getRadioGroup(field.name);
    } catch {
      rg = form.createRadioGroup(field.name);
      if (field.toolTip) {
        rg.acroField.dict.set(PDFName.of("TU"), PDFString.of(field.toolTip));
      }
    }

    const val = field.radioValue || field.exportValue || `Choice_${field.id}`;
    rg.addOptionToPage(val, page, commonOpts);

    if (field.isChecked) {
      rg.select(val);
    }
  }
}

export class SignatureControlExporter implements IControlExporter {
  shouldExport(field: FormField): boolean {
    return field.type === FieldType.SIGNATURE;
  }

  async save(
    form: PDFForm,
    field: FormField,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
  ): Promise<void> {
    const page = form.doc.getPage(field.pageIndex);

    // 1. Handle Image Signature (flattened)
    if (field.signatureData) {
      const pdfDoc = form.doc;
      const imageBytes = await fetch(field.signatureData).then((res) =>
        res.arrayBuffer(),
      );
      let image;
      if (field.signatureData.startsWith("data:image/png")) {
        image = await pdfDoc.embedPng(imageBytes);
      } else {
        image = await pdfDoc.embedJpg(imageBytes);
      }

      const imgDims = image.scale(1);
      const common = getCommonControlExportOpts(field, page, viewport);
      const boxWidth = common.width;
      const boxHeight = common.height;

      let drawWidth = boxWidth;
      let drawHeight = boxHeight;
      let drawX = common.x;
      let drawY = common.y;

      const scaleMode = field.imageScaleMode || "contain";

      if (scaleMode === "contain") {
        const widthRatio = boxWidth / imgDims.width;
        const heightRatio = boxHeight / imgDims.height;
        const scale = Math.min(widthRatio, heightRatio);

        drawWidth = imgDims.width * scale;
        drawHeight = imgDims.height * scale;

        const offsetX = (boxWidth - drawWidth) / 2;
        const offsetY = (boxHeight - drawHeight) / 2;

        drawX += offsetX;
        drawY += offsetY;
      }

      page.drawImage(image, {
        x: drawX,
        y: drawY,
        width: drawWidth,
        height: drawHeight,
      });
      return; // Done
    }

    // 2. Handle Form Field Signature (widget)
    const commonOpts = getCommonControlExportOpts(field, page, viewport);

    // Resolve font
    let fieldFont = fontMap?.get("Helvetica");
    if (field.style?.fontFamily && fontMap?.has(field.style.fontFamily)) {
      fieldFont = fontMap.get(field.style.fontFamily);
    }

    let tf;
    try {
      tf = form.getTextField(field.name);
    } catch {
      tf = form.createTextField(field.name);
    }

    tf.addToPage(page, { ...commonOpts, font: fieldFont });

    if (field.toolTip) {
      tf.acroField.dict.set(PDFName.of("TU"), PDFString.of(field.toolTip));
    }
  }
}
