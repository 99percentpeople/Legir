import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type GenerateContentParameters,
} from "@google/genai";

import { DEFAULT_FIELD_STYLE } from "@/constants";
import type { FieldStyle, FormField } from "@/types";
import { FieldType } from "@/types";
import { translateService } from "@/services/translateService";

import type {
  LLMAnalyzePageForFieldsProvider,
  LLMTranslateProvider,
  LLMTranslateTextOptions,
} from "../types";

export type GeminiModelId = "gemini-3-flash-preview" | "gemini-2.5-flash";

export type GeminiModelOption = {
  value: GeminiModelId;
  label: string;
  config?: {
    thinkingLevel?: ThinkingLevel;
  };
};

export const GEMINI_MODEL_OPTIONS: GeminiModelOption[] = [
  {
    value: "gemini-3-flash-preview",
    label: "Gemini 3 Flash Preview",
    config: {
      thinkingLevel: ThinkingLevel.MINIMAL,
    },
  },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];

const getGeminiApiKey = () => {
  return process.env.GEMINI_API_KEY || process.env.API_KEY;
};

export const GEMINI_API_AVAILABLE = !!getGeminiApiKey();

export interface AIAnalysisOptions {
  allowedTypes?: FieldType[];
  extraPrompt?: string;
  model?: GeminiModelId;
}

export interface TranslateTextOptions extends LLMTranslateTextOptions<GeminiModelId> {}

export interface TranslateTextStreamOptions extends TranslateTextOptions {}

const extractGeminiText = (value: any): string => {
  if (!value) return "";
  if (typeof value.text === "string") return value.text;

  const parts = value?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts
      .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      .join("");
  }

  return "";
};

const getGeminiModelId = (raw: string | undefined): GeminiModelId => {
  const fallback = GEMINI_MODEL_OPTIONS[0]?.value ?? "gemini-2.5-flash";
  if (!raw) return fallback;
  const known = GEMINI_MODEL_OPTIONS.some((m) => m.value === raw);
  return known ? (raw as GeminiModelId) : fallback;
};

const getGeminiModelOption = (model: GeminiModelId): GeminiModelOption => {
  return (
    GEMINI_MODEL_OPTIONS.find((m) => m.value === model) ?? {
      value: model,
      label: model,
    }
  );
};

const buildGeminiConfig = (
  model: GeminiModelId,
  opts?: { signal?: AbortSignal },
) => {
  const modelOpt = getGeminiModelOption(model);
  return {
    ...(modelOpt.config?.thinkingLevel
      ? {
          thinkingConfig: {
            thinkingLevel: modelOpt.config.thinkingLevel,
          },
        }
      : {}),
    abortSignal: opts?.signal,
  };
};

const buildTranslationPrompt = (text: string, opts: TranslateTextOptions) => {
  return `
You are a professional translator.

Task:
- Translate the following text${opts.sourceLanguage ? ` from ${opts.sourceLanguage}` : ""} to ${opts.targetLanguage}.
- Preserve the original meaning.
- Keep formatting (line breaks) where appropriate.
- Output ONLY the translated text. No explanations.

Text:
${text}
`.trim();
};

class GeminiClient {
  isAvailable() {
    return !!getGeminiApiKey();
  }

  private createClient() {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new Error("No API Key provided for Gemini.");
    }
    return new GoogleGenAI({ apiKey });
  }

  async generateContent(req: GenerateContentParameters) {
    if (!this.isAvailable()) {
      throw new Error("No API Key provided for Gemini.");
    }
    const ai = this.createClient();
    return await ai.models.generateContent(req);
  }

  async generateContentStream(req: GenerateContentParameters) {
    if (!this.isAvailable()) {
      throw new Error("No API Key provided for Gemini.");
    }
    const ai = this.createClient();
    return await ai.models.generateContentStream(req);
  }
}

const client = new GeminiClient();

export const geminiProvider: LLMTranslateProvider<GeminiModelId> &
  LLMAnalyzePageForFieldsProvider = {
  id: "gemini",
  isAvailable: () => client.isAvailable(),

  translateText: async (text, opts) => {
    const model = getGeminiModelId(opts.model);
    const prompt = buildTranslationPrompt(text, opts);

    const response = await client.generateContent({
      model,
      contents: {
        parts: [{ text: prompt }],
      },
      config: buildGeminiConfig(model, { signal: opts.signal }),
    });

    return (response.text || "").trim();
  },

  translateTextStream: async function* (text, opts) {
    const model = getGeminiModelId(opts.model);
    const prompt = buildTranslationPrompt(text, opts);

    const req: GenerateContentParameters = {
      model,
      contents: {
        parts: [{ text: prompt }],
      },
      config: buildGeminiConfig(model, { signal: opts.signal }),
    };

    const stream = await client.generateContentStream(req);
    for await (const chunk of stream) {
      const delta = extractGeminiText(chunk);
      if (delta) yield delta;
    }
  },

  analyzePageForFields: async (
    base64Image,
    pageIndex,
    pageWidth,
    pageHeight,
    existingFields = [],
    options,
  ) => {
    const typedExistingFields = existingFields as FormField[];
    const typedOptions = options as AIAnalysisOptions | undefined;

    const model = getGeminiModelId(typedOptions?.model);

    // Clean base64 string
    const cleanBase64 = base64Image.replace(
      /^data:image\/(png|jpeg|jpg);base64,/,
      "",
    );

    // Create a summary of existing fields to provide context to the AI
    // Convert to 0-1000 scale for the model
    const existingFieldsSummary = typedExistingFields.map((f) => ({
      id: f.id,
      type: f.type,
      // Provide coordinates in 0-1000 scale [ymin, xmin, ymax, xmax]
      box_2d: [
        Math.round((f.rect.y / pageHeight) * 1000),
        Math.round((f.rect.x / pageWidth) * 1000),
        Math.round(((f.rect.y + f.rect.height) / pageHeight) * 1000),
        Math.round(((f.rect.x + f.rect.width) / pageWidth) * 1000),
      ],
    }));

    const allowedTypes = typedOptions?.allowedTypes || [
      FieldType.TEXT,
      FieldType.CHECKBOX,
      FieldType.RADIO,
      FieldType.DROPDOWN,
      FieldType.SIGNATURE,
    ];

    const typeDescriptions = [];
    if (allowedTypes.includes(FieldType.TEXT)) {
      typeDescriptions.push(
        "Text Input Areas: Blank rectangles, underlines, or comb boxes.",
      );
    }
    if (allowedTypes.includes(FieldType.CHECKBOX)) {
      typeDescriptions.push("Checkboxes: Small squares intended for ticking.");
    }
    if (allowedTypes.includes(FieldType.RADIO)) {
      typeDescriptions.push(
        "Radio Buttons: Small circles intended for selection.",
      );
    }
    if (allowedTypes.includes(FieldType.DROPDOWN)) {
      typeDescriptions.push("Dropdowns: Boxes with a down arrow.");
    }
    if (allowedTypes.includes(FieldType.SIGNATURE)) {
      typeDescriptions.push(
        "Signature Fields: Lines marked with 'Sign here', 'Signature', or 'X'.",
      );
    }

    const schemaEnumMap: Record<string, string> = {
      [FieldType.TEXT]: "text",
      [FieldType.CHECKBOX]: "checkbox",
      [FieldType.RADIO]: "radio",
      [FieldType.DROPDOWN]: "dropdown",
      [FieldType.SIGNATURE]: "signature",
    };
    const currentSchemaEnum = allowedTypes
      .map((t) => schemaEnumMap[t])
      .filter(Boolean);

    const prompt = `
      You are an expert PDF form digitizer. 
      Analyze the image and identify the precise bounding boxes for user-fillable form fields.
      
      Context:
      - Image Aspect Ratio: ${pageWidth}:${pageHeight}
      - Existing Detected Fields (in 0-1000 scale [ymin, xmin, ymax, xmax]): ${JSON.stringify(
        existingFieldsSummary,
      )}
      
      Task:
      1. Analyze the image to find form fields based on the Target Elements list below.
      2. Compare with "Existing Detected Fields".
      3. Generate a list of fields. 
         - If a field is MISSING from the existing list, include it.
         - If an existing field is inaccurate, you may provide a better version.
      
      Target Elements (ONLY detect these types):
      ${typeDescriptions.map((desc, i) => `${i + 1}. ${desc}`).join("\n      ")}
      
      Bounding Box Rules:
      - Coordinates must be on a scale of 0 to 1000 (relative to image dimensions).
      - 0 is the Top/Left edge, 1000 is the Bottom/Right edge.
      - Format: [ymin, xmin, ymax, xmax]
      - TIGHT FIT: The box must contain ONLY the fillable area.
      - EXCLUDE LABELS: Do NOT include the label text in the box.

      Naming Guidelines:
      - Label: Provide a clean, human-readable label (e.g. "First Name", "Date"). 
      - CLEAN TEXT ONLY: Do NOT include leading/trailing underscores, colons, or dots (e.g. return "Thesis Title" NOT "______Thesis_Title_").

      Visual Style & Properties Estimation:
      - Background: Only set a color if there is a DISTINCT colored fill (e.g. grey box). If it looks like white paper or just lines, return "transparent".
      - Border Width: 
        * IF the field in the image ALREADY has a visible box/border: Set "border_width" to 0. We will overlay a transparent input field.
        * IF the field has NO visible border (e.g. pure whitespace): Set "border_width" to 1 to draw a box.
      - Border Color: Estimate border color if border_width > 0. Defaults to black #000000.
      - Font Size: Estimate appropriate font size (pt) based on surrounding text height.
      - Multiline (Text Fields): If the box is significantly taller than a single line of text, mark as multiline.
      - Alignment (Text Fields): Infer text alignment.
      
      Dropdown Options Inference:
      - If a field is identified as a "dropdown", attempt to infer logical options based on the label or context.

      Additional User Instructions:
      ${typedOptions?.extraPrompt || "None"}

      Output Schema:
      Return a JSON object with a "fields" array.
    `;

    const response = await client.generateContent({
      model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: cleanBase64,
            },
          },
          { text: prompt },
        ],
      },
      config: {
        ...buildGeminiConfig(model),
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            fields: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: {
                    type: Type.STRING,
                    description:
                      "The inferred label for this field (clean text only, no underscores)",
                  },
                  type: { type: Type.STRING, enum: currentSchemaEnum },
                  box_2d: {
                    type: Type.ARRAY,
                    items: { type: Type.INTEGER },
                    description: "[ymin, xmin, ymax, xmax] on 0-1000 scale",
                  },
                  options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description:
                      "For dropdowns, a list of inferred options. Null/Empty for other types.",
                    nullable: true,
                  },
                  text_preferences: {
                    type: Type.OBJECT,
                    description: "Specific properties for text fields",
                    properties: {
                      alignment: {
                        type: Type.STRING,
                        enum: ["left", "center", "right"],
                        description: "Text alignment",
                      },
                      multiline: {
                        type: Type.BOOLEAN,
                        description:
                          "True if the field appears to be a multi-line text area",
                      },
                    },
                    nullable: true,
                  },
                  visual_characteristics: {
                    type: Type.OBJECT,
                    properties: {
                      background_color: {
                        type: Type.STRING,
                        description: "Hex code (e.g. #F0F0F0) or 'transparent'",
                      },
                      border_color: {
                        type: Type.STRING,
                        description: "Hex code (e.g. #000000)",
                      },
                      border_width: {
                        type: Type.INTEGER,
                        description:
                          "Set to 0 if border exists in image, 1 otherwise.",
                      },
                      font_size: {
                        type: Type.INTEGER,
                        description: "Estimated font size in pt",
                      },
                    },
                    nullable: true,
                  },
                },
                required: ["label", "type", "box_2d"],
              },
            },
          },
        },
      },
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

      // Sanitize label for ID generation and clean display
      let rawLabel = item.label || `Field_${index}`;
      // Remove leading/trailing non-alphanumerics
      let cleanLabel = rawLabel.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
      // Replace remaining non-alphanumerics with single underscore to keep it readable but valid
      cleanLabel = cleanLabel.replace(/[^a-zA-Z0-9]+/g, "_");

      if (!cleanLabel) cleanLabel = `Field_${index}`;

      // Map string type to Enum
      let fieldType = FieldType.TEXT;
      if (item.type === "checkbox") fieldType = FieldType.CHECKBOX;
      else if (item.type === "radio") fieldType = FieldType.RADIO;
      else if (item.type === "dropdown") fieldType = FieldType.DROPDOWN;
      else if (item.type === "signature") fieldType = FieldType.SIGNATURE;

      // Parse Style (start with defaults)
      const style: FieldStyle = { ...DEFAULT_FIELD_STYLE };

      if (item.visual_characteristics) {
        const vc = item.visual_characteristics;

        if (vc.background_color) {
          const bg = vc.background_color.toLowerCase();
          // Normalize white/off-white to transparent to avoid obscuring PDF content
          if (bg === "transparent" || bg === "#ffffff" || bg === "#fff") {
            style.isTransparent = true;
          } else {
            style.backgroundColor = vc.background_color;
            style.isTransparent = false;
          }
        }

        if (vc.border_color) {
          style.borderColor = vc.border_color;
        }

        if (typeof vc.border_width === "number") {
          style.borderWidth = vc.border_width;
        }

        if (vc.font_size) {
          style.fontSize = Number(vc.font_size);
        }
      }

      // Enforce black text color for detected fields to prevent visibility issues
      style.textColor = "#000000";

      // Parse Text Preferences
      let multiline = undefined;
      let alignment: "left" | "center" | "right" | undefined = undefined;

      if (fieldType === FieldType.TEXT && item.text_preferences) {
        multiline = item.text_preferences.multiline;
        if (item.text_preferences.alignment) {
          alignment = item.text_preferences.alignment as
            | "left"
            | "center"
            | "right";
        }
      }

      return {
        id: `auto_${pageIndex}_${index}_${Date.now()}`,
        pageIndex,
        type: fieldType,
        name: cleanLabel,
        rect: { x, y, width: w, height: h },
        required: false,
        style: style,
        // Default options for dropdowns if detected, otherwise fall back to defaults
        options:
          fieldType === FieldType.DROPDOWN
            ? item.options &&
              Array.isArray(item.options) &&
              item.options.length > 0
              ? item.options
              : ["Option 1", "Option 2"]
            : undefined,
        radioValue: fieldType === FieldType.RADIO ? "Choice1" : undefined,
        multiline: multiline,
        alignment: alignment,
      } satisfies FormField;
    });
  },
};

translateService.registerOptionGroup({
  id: "gemini",
  label: "Gemini (AI)",
  labelKey: "translate.provider_gemini",
  options: GEMINI_MODEL_OPTIONS.map((opt) => ({
    id: opt.value,
    label: opt.label,
  })),
  isAvailable: () => client.isAvailable(),
  unavailableMessageKey: "ai_panel.api_key_missing",
  translate: async (text, optionId, opts) => {
    const model = getGeminiModelId(optionId);
    return await geminiProvider.translateText(text, {
      model,
      targetLanguage: opts.targetLanguage,
      sourceLanguage: opts.sourceLanguage,
      signal: opts.signal,
    });
  },
  translateStream: (text, optionId, opts) => {
    const model = getGeminiModelId(optionId);
    return geminiProvider.translateTextStream!(text, {
      model,
      targetLanguage: opts.targetLanguage,
      sourceLanguage: opts.sourceLanguage,
      signal: opts.signal,
    });
  },
});

translateService.setDefaultOptionId(
  `gemini:${GEMINI_MODEL_OPTIONS[0]?.value ?? "gemini-2.5-flash"}`,
);
