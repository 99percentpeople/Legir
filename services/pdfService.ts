
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, StandardFonts, TextAlignment, PDFName, PDFString, PDFSignature, PDFDict, PDFArray } from 'pdf-lib';
import { FormField, FieldType, PageData, FieldStyle, PDFMetadata, PDFOutlineItem } from '../types';
import { DEFAULT_FIELD_STYLE } from '../constants';

// Handle potential default export wrapper from CDN
const pdfJs = (pdfjsLib as any).default || pdfjsLib;

// Helper to convert Hex to PDF RGB
const hexToPdfColor = (hex: string | undefined) => {
  if (!hex) return undefined;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? rgb(
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255
  ) : undefined;
};

// Helper to convert PDF RGB Array (0-255) to Hex
const rgbArrayToHex = (color: number[] | Uint8ClampedArray | null | undefined): string | undefined => {
  if (!color || color.length < 3) return undefined;
  const r = Math.round(color[0]);
  const g = Math.round(color[1]);
  const b = Math.round(color[2]);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
};

// Helper to resolve PDF destination to page index
const resolveDest = async (pdf: any, dest: any): Promise<number | null> => {
  if (typeof dest === 'string') {
    try {
        dest = await pdf.getDestination(dest);
    } catch (e) {
        console.warn('Failed to resolve named destination:', dest);
        return null;
    }
  }
  
  if (!dest || !Array.isArray(dest) || dest.length < 1) return null;
  
  const ref = dest[0]; // The reference to the page (RefProxy object)
  if (!ref) return null;

  try {
    if (typeof ref === 'number') {
        return ref;
    }
    const index = await pdf.getPageIndex(ref);
    return index;
  } catch (e) {
    console.warn('Error getting page index for ref:', ref, e);
    return null;
  }
};

// Recursive mapper for outline
const mapOutline = async (pdf: any, items: any[]): Promise<PDFOutlineItem[]> => {
  const mapped: PDFOutlineItem[] = [];
  for (const item of items) {
    let pageIndex: number | undefined = undefined;
    
    let destination = item.dest;
    if (!destination && item.action && typeof item.action === 'object') {
        if (item.action.dest) {
            destination = item.action.dest;
        }
    }

    if (destination) {
        const idx = await resolveDest(pdf, destination);
        if (idx !== null) pageIndex = idx;
    }

    const children = item.items && item.items.length > 0 ? await mapOutline(pdf, item.items) : [];
    
    mapped.push({
      title: item.title,
      items: children,
      pageIndex
    });
  }
  return mapped;
};

export const loadPDF = async (file: File): Promise<{ pdfBytes: Uint8Array; pages: PageData[], fields: FormField[], metadata: PDFMetadata, outline: PDFOutlineItem[] }> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdfBytes = new Uint8Array(arrayBuffer.slice(0));
  const renderBuffer = new Uint8Array(arrayBuffer.slice(0));
  
  // Provide password callback to handle default encrypted files
  const loadingTask = pdfJs.getDocument({
      data: renderBuffer,
      password: '', 
  });
  
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const pages: PageData[] = [];
  const fields: FormField[] = [];

  // Extract Metadata
  let metadata: PDFMetadata = {};
  try {
      const { info } = await pdf.getMetadata();
      if (info) {
          metadata = {
              title: info.Title,
              author: info.Author,
              subject: info.Subject,
              keywords: info.Keywords,
              creator: info.Creator,
              producer: info.Producer
          };
      }
  } catch (e) {
      console.warn("Failed to extract metadata", e);
  }

  // Extract Outline
  let outline: PDFOutlineItem[] = [];
  try {
      const rawOutline = await pdf.getOutline();
      if (rawOutline) {
          outline = await mapOutline(pdf, rawOutline);
      }
  } catch (e) {
      console.warn("Failed to extract outline", e);
  }

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 }); 
    const unscaledViewport = page.getViewport({ scale: 1.0 });

    const annotations = await page.getAnnotations();
    
    annotations.forEach((annotation: any, index: number) => {
        if (annotation.subtype === 'Widget' && annotation.fieldName) {
            let type: FieldType | null = null;
            let options: string[] | undefined = undefined;
            let radioValue: string | undefined = undefined;
            let isChecked = false;

            if (annotation.fieldType === 'Tx') {
                type = FieldType.TEXT;
            } else if (annotation.fieldType === 'Btn') {
                 if (annotation.checkBox) {
                     type = FieldType.CHECKBOX;
                     // annotation.fieldValue is often 'Yes' or 'Off' or undefined
                     isChecked = annotation.fieldValue && annotation.fieldValue !== 'Off';
                 } else if (annotation.radioButton) {
                     type = FieldType.RADIO;
                     radioValue = annotation.buttonValue;
                     // Check if this button is the selected one in the group
                     isChecked = annotation.fieldValue === radioValue;
                 }
            } else if (annotation.fieldType === 'Ch') {
                type = FieldType.DROPDOWN;
                if (Array.isArray(annotation.options)) {
                    options = annotation.options.map((opt: any) => 
                        typeof opt === 'string' ? opt : opt.display || opt.exportValue
                    );
                }
            } else if (annotation.fieldType === 'Sig') {
                type = FieldType.SIGNATURE;
            }

            if (type) {
                const [x1, y1, x2, y2] = annotation.rect;
                const width = x2 - x1;
                const height = y2 - y1;
                const x = x1;
                const y = unscaledViewport.height - y2;

                const importedStyle: FieldStyle = { ...DEFAULT_FIELD_STYLE };

                if (annotation.backgroundColor) {
                    importedStyle.backgroundColor = rgbArrayToHex(annotation.backgroundColor);
                    importedStyle.isTransparent = false;
                } else {
                    importedStyle.isTransparent = true;
                }

                if (annotation.color) {
                    importedStyle.borderColor = rgbArrayToHex(annotation.color);
                }
                
                if (annotation.borderStyle && typeof annotation.borderStyle.width === 'number') {
                    importedStyle.borderWidth = annotation.borderStyle.width;
                }

                const da = annotation.defaultAppearance || "";
                if (da) {
                    const fontSizeMatch = da.match(/(\d+(\.\d+)?)\s+Tf/);
                    if (fontSizeMatch) {
                        importedStyle.fontSize = parseFloat(fontSizeMatch[1]);
                    }

                    const rgbMatch = da.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+[rR]g/);
                    const grayMatch = da.match(/([\d.]+)\s+[gG]/);

                    if (rgbMatch) {
                        const r = parseFloat(rgbMatch[1]) * 255;
                        const g = parseFloat(rgbMatch[2]) * 255;
                        const b = parseFloat(rgbMatch[3]) * 255;
                        importedStyle.textColor = rgbArrayToHex([r, g, b]);
                    } else if (grayMatch) {
                         const g = parseFloat(grayMatch[1]) * 255;
                         importedStyle.textColor = rgbArrayToHex([g, g, g]);
                    }
                }

                fields.push({
                    id: `imported_${i}_${index}_${annotation.fieldName}`,
                    pageIndex: i - 1,
                    type: type,
                    name: annotation.fieldName,
                    rect: { x, y, width, height },
                    required: !!(annotation.fieldFlags & 2),
                    readOnly: !!(annotation.fieldFlags & 1),
                    toolTip: annotation.alternativeText || undefined,
                    style: importedStyle,
                    options: options,
                    radioValue: radioValue || undefined,
                    exportValue: radioValue, // Map radio value to exportValue
                    multiline: type === FieldType.TEXT ? !!(annotation.fieldFlags & 4096) : undefined,
                    maxLength: annotation.maxLen || undefined,
                    alignment: annotation.textAlignment === 1 ? 'center' : (annotation.textAlignment === 2 ? 'right' : 'left'),
                    
                    // Map Values
                    value: typeof annotation.fieldValue === 'string' ? annotation.fieldValue : undefined,
                    defaultValue: typeof annotation.defaultValue === 'string' ? annotation.defaultValue : undefined,
                    isChecked: isChecked,
                    isDefaultChecked: false // Hard to extract reliability from PDF.js annotation without parsing raw dict
                });
            }
        }
    });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    if (context) {
      await page.render({
        canvasContext: context,
        viewport: viewport,
        annotationMode: pdfJs.AnnotationMode.DISABLE,
      }).promise;
      
      pages.push({
        pageIndex: i - 1,
        width: viewport.width / 1.5,
        height: viewport.height / 1.5,
        imageData: canvas.toDataURL('image/jpeg', 0.8),
      });
    }
  }

  return { pdfBytes, pages, fields, metadata, outline };
};

export const exportPDF = async (originalBytes: Uint8Array, fields: FormField[], metadata?: PDFMetadata): Promise<Uint8Array> => {
  if (originalBytes.byteLength === 0) {
    throw new Error("PDF buffer is empty.");
  }

  const pdfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
  
  if (metadata) {
      if (metadata.title) pdfDoc.setTitle(metadata.title);
      if (metadata.author) pdfDoc.setAuthor(metadata.author);
      if (metadata.subject) pdfDoc.setSubject(metadata.subject);
      if (metadata.creator) pdfDoc.setCreator(metadata.creator);
      if (metadata.producer) pdfDoc.setProducer(metadata.producer);
      if (metadata.keywords) {
          const keywordsArray = metadata.keywords.split(/,|;/).map(k => k.trim()).filter(k => k.length > 0);
          pdfDoc.setKeywords(keywordsArray);
      }
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const form = pdfDoc.getForm();

  // 1. Remove existing fields of types we manage
  const existingFields = form.getFields();
  for (const field of existingFields) {
      let shouldRemove = false;
      try {
          // Robust check for field types including fallback to constructor name
          const typeName = field.constructor.name;
          const isText = field instanceof PDFTextField || typeName === 'PDFTextField';
          const isCheck = field instanceof PDFCheckBox || typeName === 'PDFCheckBox';
          const isDropdown = field instanceof PDFDropdown || typeName === 'PDFDropdown';
          const isRadio = field instanceof PDFRadioGroup || typeName === 'PDFRadioGroup';
          const isSig = (typeof PDFSignature !== 'undefined' && field instanceof PDFSignature) || typeName === 'PDFSignature';

          shouldRemove = isText || isCheck || isDropdown || isRadio || isSig;

          if (shouldRemove) { 
              form.removeField(field);
          }
      } catch (e) {
          // Warning only - prevents crash on corrupt PDFs
          console.warn(`Attempting manual removal for corrupt field: ${field.getName()}`);
          
          // Fallback: Try to remove from AcroForm fields array manually to prevent collisions
          if (shouldRemove) {
              try {
                  const fieldRef = (field as any).ref;

                  // 1. Detach from AcroForm
                  const acroForm = pdfDoc.catalog.get(PDFName.of('AcroForm'));
                  if (acroForm instanceof PDFDict) {
                      const acroFields = acroForm.get(PDFName.of('Fields'));
                      if (acroFields instanceof PDFArray) {
                          const idx = acroFields.indexOf(fieldRef);
                          if (idx !== -1) {
                              acroFields.remove(idx);
                          }
                      }
                  }

                  // 2. Detach visual widgets from pages
                  const acroField = (field as any).acroField;
                  if (acroField && typeof acroField.getWidgets === 'function') {
                      const widgets = acroField.getWidgets();
                      if (Array.isArray(widgets)) {
                          const pages = pdfDoc.getPages();
                          for (const page of pages) {
                              const annots = page.node.Annots();
                              if (annots instanceof PDFArray) {
                                  for (const widget of widgets) {
                                      const wIdx = annots.indexOf(widget);
                                      if (wIdx !== -1) {
                                          annots.remove(wIdx);
                                      }
                                  }
                              }
                          }
                      }
                  }
              } catch (cleanupErr) {
                  console.error('Manual cleanup failed:', cleanupErr);
              }
          }
      }
  }

  // 2. Group Radio buttons by name
  const radioGroups: Record<string, FormField[]> = {};
  const otherFields: FormField[] = [];

  for (const field of fields) {
      if (field.type === FieldType.RADIO) {
          if (!radioGroups[field.name]) {
              radioGroups[field.name] = [];
          }
          radioGroups[field.name].push(field);
      } else {
          otherFields.push(field);
      }
  }

  // Helper to generate common properties
  const getFieldOptions = (field: FormField, page: any, pageHeight: number) => {
      const pdfX = Number(field.rect.x);
      const pdfY = pageHeight - Number(field.rect.y) - Number(field.rect.height);
      const pdfWidth = Number(field.rect.width);
      const pdfHeight = Number(field.rect.height);
      
      const style = field.style || DEFAULT_FIELD_STYLE;
      const borderColor = hexToPdfColor(style.borderColor);
      const backgroundColor = style.isTransparent ? undefined : hexToPdfColor(style.backgroundColor);
      const textColor = hexToPdfColor(style.textColor);
      const borderWidth = style.borderWidth ?? 1;

      return {
          x: pdfX,
          y: pdfY,
          width: pdfWidth,
          height: pdfHeight,
          borderColor,
          backgroundColor,
          borderWidth,
          textColor,
      };
  };

  // 3. Create Non-Radio Fields
  for (const field of otherFields) {
    try {
      const page = pdfDoc.getPage(field.pageIndex);
      const { height: pageHeight } = page.getSize();
      const commonOpts = getFieldOptions(field, page, pageHeight);
      const style = field.style || DEFAULT_FIELD_STYLE;
      const fontSize = style.fontSize ?? 12;

      const createField = (name: string) => {
          if (field.type === FieldType.TEXT || field.type === FieldType.SIGNATURE) {
            // Handle Signature as Text for now
            const textField = form.createTextField(name);
            textField.addToPage(page, { ...commonOpts, font: font });
            
            // Set Value and Default Value
            textField.setText(field.value || '');
            if (field.defaultValue) {
                // Low-level: Set Default Value (DV)
                (textField as any).acroField.dict.set(PDFName.of('DV'), PDFString.of(field.defaultValue));
            }

            if (fontSize) textField.setFontSize(fontSize);
            
            if (field.toolTip) (textField as any).acroField.dict.set(PDFName.of('TU'), PDFString.of(field.toolTip));
            if (field.required) textField.enableRequired();
            if (field.readOnly) textField.enableReadOnly();
            if (field.multiline) textField.enableMultiline();
            if (field.maxLength) textField.setMaxLength(field.maxLength);
            if (field.alignment) {
                 switch(field.alignment) {
                     case 'center': textField.setAlignment(TextAlignment.Center); break;
                     case 'right': textField.setAlignment(TextAlignment.Right); break;
                     default: textField.setAlignment(TextAlignment.Left); break;
                 }
            }

            textField.updateAppearances(font);

          } else if (field.type === FieldType.CHECKBOX) {
            const checkBox = form.createCheckBox(name);
            checkBox.addToPage(page, commonOpts);

            if (field.toolTip) (checkBox as any).acroField.dict.set(PDFName.of('TU'), PDFString.of(field.toolTip));
            if (field.required) checkBox.enableRequired();
            if (field.readOnly) checkBox.enableReadOnly();
            
            // Current State
            if (field.isChecked) checkBox.check();
            
            // Default State (DV)
            if (field.isDefaultChecked) {
                 // Assuming export value 'Yes' which is default in pdf-lib for created checkboxes
                 (checkBox as any).acroField.dict.set(PDFName.of('DV'), PDFName.of('Yes'));
            } else {
                 (checkBox as any).acroField.dict.set(PDFName.of('DV'), PDFName.of('Off'));
            }

          } else if (field.type === FieldType.DROPDOWN) {
            const dropdown = form.createDropdown(name);
            dropdown.addToPage(page, { ...commonOpts, font: font });
            if (field.options) {
                dropdown.setOptions(field.options);
            }
            
            // Current Value
            if (field.value) dropdown.select(field.value);

            // Default Value
            if (field.defaultValue) {
                 (dropdown as any).acroField.dict.set(PDFName.of('DV'), PDFString.of(field.defaultValue));
            }

            if (fontSize) dropdown.setFontSize(fontSize);
            
            if (field.toolTip) (dropdown as any).acroField.dict.set(PDFName.of('TU'), PDFString.of(field.toolTip));
            if (field.required) dropdown.enableRequired();
            if (field.readOnly) dropdown.enableReadOnly();

            dropdown.updateAppearances(font);
          }
      };

      try {
        createField(field.name);
      } catch (e) {
        // Retry with unique name
        createField(`${field.name}_${Math.random().toString(36).substring(7)}`);
      }
    } catch (e) {
        console.error(`Error creating field ${field.name}`, e);
    }
  }

  // 4. Create Radio Groups
  for (const [name, groupFields] of Object.entries(radioGroups)) {
      try {
          const radioGroup = form.createRadioGroup(name);
          const firstField = groupFields[0];
          if (firstField) {
              if (firstField.toolTip) (radioGroup as any).acroField.dict.set(PDFName.of('TU'), PDFString.of(firstField.toolTip));
              if (firstField.required) radioGroup.enableRequired();
              if (firstField.readOnly) radioGroup.enableReadOnly();
          }
          
          // Determine Default Value for the Group
          const defaultSelectedField = groupFields.find(f => f.isDefaultChecked);
          if (defaultSelectedField) {
              const val = defaultSelectedField.radioValue || defaultSelectedField.exportValue || `Choice_${groupFields.indexOf(defaultSelectedField)}`;
              // Set Default Value for Group (DV is a name)
              (radioGroup as any).acroField.dict.set(PDFName.of('DV'), PDFName.of(val));
          }

          for (let i = 0; i < groupFields.length; i++) {
              const field = groupFields[i];
              try {
                  const page = pdfDoc.getPage(field.pageIndex);
                  const { height: pageHeight } = page.getSize();
                  const commonOpts = getFieldOptions(field, page, pageHeight);
                  
                  // Ensure unique values for options in group
                  const val = field.radioValue || field.exportValue || `Choice_${i}`;
                  radioGroup.addOptionToPage(val, page, commonOpts);
                  
                  if (field.isChecked) {
                      radioGroup.select(val);
                  }
              } catch (err) {
                  console.warn(`Skipping radio option in group ${name}`, err);
              }
          }
      } catch (e) {
          console.error(`Error creating radio group ${name}`, e);
      }
  }

  try {
    form.updateFieldAppearances(font);
  } catch (e) {
    console.warn("Failed to update global field appearances", e);
  }

  return await pdfDoc.save();
};
