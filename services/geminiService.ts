import { GoogleGenAI, Type } from "@google/genai";
import { FieldType, FormField, FieldStyle } from "../types";

export const analyzePageForFields = async (
  base64Image: string, 
  pageIndex: number, 
  pageWidth: number, 
  pageHeight: number
): Promise<FormField[]> => {
  if (!process.env.API_KEY) {
    console.warn("No API Key provided for Gemini.");
    return [];
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Clean base64 string
    const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");

    const prompt = `
      You are an expert PDF form digitizer. 
      Analyze the image and identify the precise bounding boxes for all user-fillable form fields.
      
      Target Elements:
      1. Text Input Areas: Blank rectangles, underlined spaces, or comb boxes designed for handwriting or typing.
      2. Checkboxes/Radio Buttons: Small squares or circles meant for selection.
      
      Bounding Box Rules:
      - Coordinates must be strictly relative PERCENTAGES (0.0 to 100.0) of the image dimensions.
      - Format: [ymin, xmin, ymax, xmax]
      - ymin: Top edge %, xmin: Left edge %, ymax: Bottom edge %, xmax: Right edge %.
      - TIGHT FIT: The box must contain ONLY the fillable area (the line, the box, or the checkbox itself). 
      - EXCLUDE LABELS: Do NOT include the label text inside the bounding box.

      Visual Style Estimation:
      - Background: If the field is a shaded box, provide the rough Hex color (e.g., #E6E6E6). If it is just an underline or whitespace, mark it as transparent.
      - Border: Estimate the border color (usually #000000).
      - Font Size: Estimate the font size (pt) relative to the surrounding text (e.g., 10, 12, 14).
      
      Output Schema:
      Return a JSON object with a "fields" array.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
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
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            fields: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING, description: "The text label associated with this field (e.g. 'First Name')" },
                  type: { type: Type.STRING, enum: ["text", "checkbox"] },
                  box_2d: { 
                    type: Type.ARRAY, 
                    items: { type: Type.NUMBER },
                    description: "[ymin, xmin, ymax, xmax] as percentages (0.0 to 100.0)"
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
      
      // Convert Percentage (0-100) to pixel scale
      const yMinVal = Number(ymin);
      const xMinVal = Number(xmin);
      const yMaxVal = Number(ymax);
      const xMaxVal = Number(xmax);

      const x = (xMinVal / 100) * pageWidth;
      const y = (yMinVal / 100) * pageHeight;
      const w = ((xMaxVal - xMinVal) / 100) * pageWidth;
      const h = ((yMaxVal - yMinVal) / 100) * pageHeight;

      // Sanitize label for ID generation
      const sanitizedLabel = (item.label || `Field_${index}`).replace(/[^a-zA-Z0-9]/g, '_');

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

      return {
        id: `auto_${pageIndex}_${index}_${Date.now()}`,
        pageIndex,
        type: item.type === 'checkbox' ? FieldType.CHECKBOX : FieldType.TEXT,
        name: sanitizedLabel,
        rect: { x, y, width: w, height: h },
        required: false,
        style: Object.keys(style).length > 0 ? style : undefined
      };
    });

  } catch (error) {
    console.error("Gemini analysis failed:", error);
    return [];
  }
};