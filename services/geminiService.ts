
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { FieldType, FormField, FieldStyle } from "../types";

export const analyzePageForFields = async (
  base64Image: string,
  pageIndex: number,
  pageWidth: number,
  pageHeight: number,
  existingFields: FormField[] = []
): Promise<FormField[]> => {
  if (!process.env.API_KEY) {
    console.warn("No API Key provided for Gemini.");
    return [];
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    // Clean base64 string
    const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");

    // Create a summary of existing fields to provide context to the AI
    // Convert to 0-1000 scale for the model
    const existingFieldsSummary = existingFields.map(f => ({
        id: f.id,
        type: f.type,
        // Provide coordinates in 0-1000 scale [ymin, xmin, ymax, xmax]
        box_2d: [
            Math.round((f.rect.y / pageHeight) * 1000),
            Math.round((f.rect.x / pageWidth) * 1000),
            Math.round(((f.rect.y + f.rect.height) / pageHeight) * 1000),
            Math.round(((f.rect.x + f.rect.width) / pageWidth) * 1000)
        ]
    }));

    const prompt = `
      You are an expert PDF form digitizer. 
      Analyze the image and identify the precise bounding boxes for user-fillable form fields.
      
      Context:
      - Image Aspect Ratio: ${pageWidth}:${pageHeight}
      - Existing Detected Fields (in 0-1000 scale [ymin, xmin, ymax, xmax]): ${JSON.stringify(existingFieldsSummary)}
      
      Task:
      1. Analyze the image to find form fields (Text Inputs, Checkboxes, Radio Buttons, Dropdowns, Signature Lines).
      2. Compare with "Existing Detected Fields".
      3. Generate a list of fields. 
         - If a field is MISSING from the existing list, include it.
         - If an existing field is inaccurate, you may provide a better version (the system will handle merging).
      
      Target Elements:
      1. Text Input Areas: 
         - Blank rectangles or boxes.
         - Underlines (the field is the empty space ABOVE the line).
         - Comb boxes (segmented boxes for characters).
      2. Checkboxes: Small squares intended for ticking.
      3. Radio Buttons: Small circles intended for selection.
      4. Dropdowns: Box with a down arrow.
      5. Signature Fields: Lines with "Sign here", "Signature", or "X" markings intended for a signature.
      
      Bounding Box Rules:
      - Coordinates must be on a scale of 0 to 1000 (relative to image dimensions).
      - 0 is the Top/Left edge, 1000 is the Bottom/Right edge.
      - Format: [ymin, xmin, ymax, xmax]
      - ymin: Top edge, xmin: Left edge, ymax: Bottom edge, xmax: Right edge.
      - TIGHT FIT: The box must contain ONLY the fillable area.
      - EXCLUDE LABELS: Do NOT include the label text.

      Visual Style & Properties Estimation:
      - Background: If the field is a filled box, estimate Hex color (e.g., #F0F0F0). If it's whitespace or just a line, mark as transparent.
      - Border: Estimate border color (usually #000000).
      - Font Size: Estimate appropriate font size (pt) based on surrounding text height.
      - Multiline (Text Fields): If the box is significantly taller than a single line of text (e.g. > 2.5x standard text height), mark as multiline.
      - Alignment (Text Fields): Infer text alignment (left, center, right). 
         - Default is 'left'. 
         - Comb boxes or specific number inputs are often 'center'. 
         - Financial figures might be 'right'.
      
      Dropdown Options Inference:
      - If a field is identified as a "dropdown", attempt to infer logical options based on the label or context (e.g., Label "Gender" -> ["Male", "Female"], Label "State" -> ["CA", "NY", ...], Label "Yes/No" -> ["Yes", "No"]).
      - If the options are not obvious, provide a few generic placeholders or leave empty.

      Output Schema:
      Return a JSON object with a "fields" array.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: cleanBase64
            }
          },
          { text: prompt }
        ]
      },
      config: {
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW
        },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            fields: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING, description: "The inferred label for this field (e.g. 'First Name')" },
                  type: { type: Type.STRING, enum: ["text", "checkbox", "radio", "dropdown", "signature"] },
                  box_2d: {
                    type: Type.ARRAY,
                    items: { type: Type.INTEGER },
                    description: "[ymin, xmin, ymax, xmax] on 0-1000 scale"
                  },
                  options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "For dropdowns, a list of inferred options. Null/Empty for other types.",
                    nullable: true
                  },
                  text_preferences: {
                    type: Type.OBJECT,
                    description: "Specific properties for text fields",
                    properties: {
                      alignment: { type: Type.STRING, enum: ["left", "center", "right"], description: "Text alignment" },
                      multiline: { type: Type.BOOLEAN, description: "True if the field appears to be a multi-line text area" }
                    },
                    nullable: true
                  },
                  visual_characteristics: {
                    type: Type.OBJECT,
                    properties: {
                      background_color: { type: Type.STRING, description: "Hex code (e.g. #F0F0F0) or 'transparent'" },
                      border_color: { type: Type.STRING, description: "Hex code (e.g. #000000)" },
                      font_size: { type: Type.INTEGER, description: "Estimated font size in pt" }
                    },
                    nullable: true
                  }
                },
                required: ["label", "type", "box_2d"]
              }
            }
          }
        }
      }
    });

    const jsonText = response.text;
    if (!jsonText) return [];

    const result = JSON.parse(jsonText);

    if (!result.fields || !Array.isArray(result.fields)) return [];

    return result.fields.map((item: any, index: number) => {
      const [ymin, xmin, ymax, xmax] = item.box_2d;

      // Convert 0-1000 scale to pixel scale
      const yMinVal = Math.max(0, Math.min(1000, Number(ymin)));
      const xMinVal = Math.max(0, Math.min(1000, Number(xmin)));
      const yMaxVal = Math.max(0, Math.min(1000, Number(ymax)));
      const xMaxVal = Math.max(0, Math.min(1000, Number(xmax)));

      const x = (xMinVal / 1000) * pageWidth;
      const y = (yMinVal / 1000) * pageHeight;
      const w = ((xMaxVal - xMinVal) / 1000) * pageWidth;
      const h = ((yMaxVal - yMinVal) / 1000) * pageHeight;

      // Sanitize label for ID generation
      const sanitizedLabel = (item.label || `Field_${index}`).replace(/[^a-zA-Z0-9]/g, '_');

      // Map string type to Enum
      let fieldType = FieldType.TEXT;
      if (item.type === 'checkbox') fieldType = FieldType.CHECKBOX;
      else if (item.type === 'radio') fieldType = FieldType.RADIO;
      else if (item.type === 'dropdown') fieldType = FieldType.DROPDOWN;
      else if (item.type === 'signature') fieldType = FieldType.SIGNATURE;

      // Parse Style
      const style: FieldStyle = {};
      if (item.visual_characteristics) {
        const vc = item.visual_characteristics;

        if (vc.background_color && vc.background_color.toLowerCase() !== 'transparent') {
          style.backgroundColor = vc.background_color;
          style.isTransparent = false;
        } else {
          style.isTransparent = true;
        }

        if (vc.border_color) {
          style.borderColor = vc.border_color;
        }

        if (vc.font_size) {
          style.fontSize = Number(vc.font_size);
        }
      }

      // Parse Text Preferences
      let multiline = undefined;
      let alignment: 'left' | 'center' | 'right' | undefined = undefined;
      
      if (fieldType === FieldType.TEXT && item.text_preferences) {
          multiline = item.text_preferences.multiline;
          if (item.text_preferences.alignment) {
              alignment = item.text_preferences.alignment as 'left' | 'center' | 'right';
          }
      }

      return {
        id: `auto_${pageIndex}_${index}_${Date.now()}`,
        pageIndex,
        type: fieldType,
        name: sanitizedLabel,
        rect: { x, y, width: w, height: h },
        required: false,
        style: Object.keys(style).length > 0 ? style : undefined,
        // Default options for dropdowns if detected, otherwise fall back to defaults
        options: fieldType === FieldType.DROPDOWN 
            ? (item.options && Array.isArray(item.options) && item.options.length > 0 ? item.options : ['Option 1', 'Option 2']) 
            : undefined,
        radioValue: fieldType === FieldType.RADIO ? 'Choice1' : undefined,
        multiline: multiline,
        alignment: alignment
      };
    });

  } catch (error) {
    console.error("Gemini analysis failed:", error);
    return [];
  }
};