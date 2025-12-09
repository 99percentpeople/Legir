import { PDFForm, PDFName, PDFString, TextAlignment } from "pdf-lib";
import { FormField, FieldType } from "@/types";
import { IControlExporter } from "../types";
import { hexToPdfColor } from "@/lib/pdf-helpers";

// Helper for common options
const getCommonOpts = (field: FormField, pageHeight: number) => ({
  x: field.rect.x,
  y: pageHeight - field.rect.y - field.rect.height,
  width: field.rect.width,
  height: field.rect.height,
  borderColor: hexToPdfColor(field.style?.borderColor),
  backgroundColor: field.style?.isTransparent
    ? undefined
    : hexToPdfColor(field.style?.backgroundColor),
  borderWidth: field.style?.borderWidth ?? 1,
  textColor: hexToPdfColor(field.style?.textColor),
});

export class TextControlExporter implements IControlExporter {
  shouldExport(field: FormField): boolean {
    return field.type === FieldType.TEXT;
  }

  save(form: PDFForm, field: FormField, fontMap?: Map<string, any>): void {
    const page = form.doc.getPage(field.pageIndex);
    const pageHeight = page.getSize().height;
    const commonOpts = getCommonOpts(field, pageHeight);

    // Resolve font
    let fieldFont = fontMap?.get("Helvetica"); // Default
    if (field.style?.fontFamily && fontMap?.has(field.style.fontFamily)) {
      fieldFont = fontMap.get(field.style.fontFamily);
    }

    let tf;
    try {
      tf = form.getTextField(field.name);
    } catch (e) {
      tf = form.createTextField(field.name);
    }

    tf.addToPage(page, { ...commonOpts, font: fieldFont });

    if (field.value) {
      tf.setText(field.value);
    }
    if (field.toolTip) {
      tf.acroField.dict.set(PDFName.of("TU"), PDFString.of(field.toolTip));
    }

    if (field.style?.fontSize) tf.setFontSize(field.style.fontSize);

    if (field.alignment === "center") tf.setAlignment(TextAlignment.Center);
    else if (field.alignment === "right") tf.setAlignment(TextAlignment.Right);

    if (field.multiline) tf.enableMultiline();

    if (fieldFont) {
      tf.updateAppearances(fieldFont);
    }
  }
}

export class CheckboxControlExporter implements IControlExporter {
  shouldExport(field: FormField): boolean {
    return field.type === FieldType.CHECKBOX;
  }

  save(form: PDFForm, field: FormField, fontMap?: Map<string, any>): void {
    const page = form.doc.getPage(field.pageIndex);
    const pageHeight = page.getSize().height;
    const commonOpts = getCommonOpts(field, pageHeight);

    let cb;
    try {
      cb = form.getCheckBox(field.name);
    } catch (e) {
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

  save(form: PDFForm, field: FormField, fontMap?: Map<string, any>): void {
    const page = form.doc.getPage(field.pageIndex);
    const pageHeight = page.getSize().height;
    const commonOpts = getCommonOpts(field, pageHeight);

    // Resolve font
    let fieldFont = fontMap?.get("Helvetica");
    if (field.style?.fontFamily && fontMap?.has(field.style.fontFamily)) {
      fieldFont = fontMap.get(field.style.fontFamily);
    }

    if (field.isMultiSelect) {
      let ol;
      try {
        ol = form.getOptionList(field.name);
      } catch (e) {
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
      if (fieldFont) ol.updateAppearances(fieldFont);
    } else {
      let dd;
      try {
        dd = form.getDropdown(field.name);
      } catch (e) {
        dd = form.createDropdown(field.name);
      }

      dd.addToPage(page, { ...commonOpts, font: fieldFont });
      if (field.options) dd.setOptions(field.options);

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
      if (fieldFont) dd.updateAppearances(fieldFont);
    }
  }
}

export class RadioControlExporter implements IControlExporter {
  shouldExport(field: FormField): boolean {
    return field.type === FieldType.RADIO;
  }

  save(form: PDFForm, field: FormField, fontMap?: Map<string, any>): void {
    const page = form.doc.getPage(field.pageIndex);
    const pageHeight = page.getSize().height;
    const commonOpts = getCommonOpts(field, pageHeight);

    let rg;
    try {
      rg = form.getRadioGroup(field.name);
    } catch (e) {
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
    fontMap?: Map<string, any>,
  ): Promise<void> {
    const page = form.doc.getPage(field.pageIndex);
    const pageHeight = page.getSize().height;

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
      const boxWidth = field.rect.width;
      const boxHeight = field.rect.height;

      let drawWidth = boxWidth;
      let drawHeight = boxHeight;
      let drawX = field.rect.x;
      let drawY = pageHeight - field.rect.y - field.rect.height;

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
    const commonOpts = getCommonOpts(field, pageHeight);

    // Resolve font
    let fieldFont = fontMap?.get("Helvetica");
    if (field.style?.fontFamily && fontMap?.has(field.style.fontFamily)) {
      fieldFont = fontMap.get(field.style.fontFamily);
    }

    let tf;
    try {
      tf = form.getTextField(field.name);
    } catch (e) {
      tf = form.createTextField(field.name);
    }

    tf.addToPage(page, { ...commonOpts, font: fieldFont });

    if (field.toolTip) {
      tf.acroField.dict.set(PDFName.of("TU"), PDFString.of(field.toolTip));
    }
  }
}
