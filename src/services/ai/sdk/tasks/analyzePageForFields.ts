import { generateText } from "ai";
import { z } from "zod";

import { DEFAULT_FIELD_STYLE } from "@/constants";
import { parseJsonTextWithSchema } from "@/services/ai/utils/json";
import { resolveAiSdkLanguageModel } from "@/services/ai/sdk/modelRegistry";
import type { AiSdkModelSpecifier } from "@/services/ai/sdk/types";
import type { LLMAnalyzePageForFieldsOptions } from "@/services/ai/types";
import {
  FieldType,
  type FieldStyle,
  type FormField,
  type AppOptions,
} from "@/types";

const formFieldResponseSchema = z.object({
  fields: z
    .array(
      z.object({
        label: z.string(),
        type: z.enum(["text", "checkbox", "radio", "dropdown", "signature"]),
        box_2d: z
          .array(z.union([z.number(), z.string()]))
          .min(4)
          .max(4),
        options: z.array(z.string()).nullish(),
        text_preferences: z
          .object({
            alignment: z.enum(["left", "center", "right"]).optional(),
            multiline: z.boolean().optional(),
          })
          .nullish(),
        visual_characteristics: z
          .object({
            background_color: z.string().optional(),
            border_color: z.string().optional(),
            border_width: z.union([z.number(), z.string()]).optional(),
            font_size: z.union([z.number(), z.string()]).optional(),
          })
          .nullish(),
      }),
    )
    .default([]),
});

const clampBoxCoordinate = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1000, numeric));
};

const normalizeFieldLabel = (rawLabel: string, index: number) => {
  let cleanLabel = rawLabel.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
  cleanLabel = cleanLabel.replace(/[^a-zA-Z0-9]+/g, "_");
  return cleanLabel || `Field_${index}`;
};

const normalizeFieldType = (
  value: "text" | "checkbox" | "radio" | "dropdown" | "signature",
) => {
  if (value === "checkbox") return FieldType.CHECKBOX;
  if (value === "radio") return FieldType.RADIO;
  if (value === "dropdown") return FieldType.DROPDOWN;
  if (value === "signature") return FieldType.SIGNATURE;
  return FieldType.TEXT;
};

const buildFormDetectPrompt = (options: {
  pageWidth: number;
  pageHeight: number;
  existingFieldsSummary: Array<{
    id: string;
    type: string;
    box_2d: [number, number, number, number];
  }>;
  allowedTypes: FieldType[];
  extraPrompt?: string;
}) => {
  const typeDescriptions: string[] = [];

  if (options.allowedTypes.includes(FieldType.TEXT)) {
    typeDescriptions.push(
      "Text Input Areas: Blank rectangles, underlines, or comb boxes.",
    );
  }
  if (options.allowedTypes.includes(FieldType.CHECKBOX)) {
    typeDescriptions.push("Checkboxes: Small squares intended for ticking.");
  }
  if (options.allowedTypes.includes(FieldType.RADIO)) {
    typeDescriptions.push(
      "Radio Buttons: Small circles intended for selection.",
    );
  }
  if (options.allowedTypes.includes(FieldType.DROPDOWN)) {
    typeDescriptions.push("Dropdowns: Boxes with a down arrow.");
  }
  if (options.allowedTypes.includes(FieldType.SIGNATURE)) {
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

  const currentSchemaEnum = options.allowedTypes
    .map((type) => schemaEnumMap[type])
    .filter(Boolean);

  return `
You are an expert PDF form digitizer.
Analyze the image and identify the precise bounding boxes for user-fillable form fields.

Context:
- Image Aspect Ratio: ${options.pageWidth}:${options.pageHeight}
- Existing Detected Fields (in 0-1000 scale [ymin, xmin, ymax, xmax]): ${JSON.stringify(
    options.existingFieldsSummary,
  )}

Task:
1. Analyze the image to find form fields based on the Target Elements list below.
2. Compare with the existing detected fields.
3. Generate a list of fields.
   - If a field is missing from the existing list, include it.
   - If an existing field is inaccurate, you may provide a better version.

Target Elements (ONLY detect these types):
${typeDescriptions.map((description, index) => `${index + 1}. ${description}`).join("\n")}

Bounding Box Rules:
- Coordinates must be on a scale of 0 to 1000 relative to image dimensions.
- 0 is the top or left edge, 1000 is the bottom or right edge.
- Format: [ymin, xmin, ymax, xmax]
- TIGHT FIT: The box must contain ONLY the fillable area.
- EXCLUDE LABELS: Do NOT include the label text in the box.

Naming Guidelines:
- Label: Provide a clean, human-readable label such as "First Name" or "Date".
- CLEAN TEXT ONLY: Do NOT include leading or trailing underscores, colons, or dots.

Visual Style & Properties Estimation:
- Background: Only set a color if there is a distinct colored fill. Otherwise return "transparent".
- Border Width:
  * If the field in the image already has a visible box or border, set "border_width" to 0.
  * If the field has no visible border, set "border_width" to 1.
- Border Color: Estimate border color if border_width > 0.
- Font Size: Estimate appropriate font size based on surrounding text height.
- Multiline (Text Fields): If the box is significantly taller than a single line of text, mark as multiline.
- Alignment (Text Fields): Infer text alignment.

Dropdown Options Inference:
- If a field is identified as a dropdown, attempt to infer logical options based on the label or context.

Additional User Instructions:
${options.extraPrompt || "None"}

Output Schema:
Return a JSON object with a "fields" array.
Each item must include:
- label: string
- type: one of ${JSON.stringify(currentSchemaEnum)}
- box_2d: [ymin, xmin, ymax, xmax]
Optional:
- options: string[] (dropdown only)
- text_preferences: { alignment: "left"|"center"|"right", multiline: boolean }
- visual_characteristics: { background_color: string, border_color: string, border_width: number, font_size: number }
`.trim();
};

export const analyzePageForFieldsWithAiSdk = async (options: {
  appOptions: AppOptions;
  specifier: AiSdkModelSpecifier;
  base64Image: string;
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  existingFields?: FormField[];
  analyzeOptions?: LLMAnalyzePageForFieldsOptions;
  signal?: AbortSignal;
}): Promise<FormField[]> => {
  const model = resolveAiSdkLanguageModel(
    options.appOptions,
    options.specifier,
  );
  const typedExistingFields = options.existingFields || [];
  const allowedTypes = options.analyzeOptions?.allowedTypes || [
    FieldType.TEXT,
    FieldType.CHECKBOX,
    FieldType.RADIO,
    FieldType.DROPDOWN,
    FieldType.SIGNATURE,
  ];

  const existingFieldsSummary = typedExistingFields.map((field) => ({
    id: field.id,
    type: field.type,
    box_2d: [
      Math.round((field.rect.y / options.pageHeight) * 1000),
      Math.round((field.rect.x / options.pageWidth) * 1000),
      Math.round(
        ((field.rect.y + field.rect.height) / options.pageHeight) * 1000,
      ),
      Math.round(
        ((field.rect.x + field.rect.width) / options.pageWidth) * 1000,
      ),
    ] as [number, number, number, number],
  }));

  const result = await generateText({
    model,
    system:
      "Return only JSON. Do not wrap in markdown fences. Do not add commentary.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildFormDetectPrompt({
              pageWidth: options.pageWidth,
              pageHeight: options.pageHeight,
              existingFieldsSummary,
              allowedTypes,
              extraPrompt: options.analyzeOptions?.extraPrompt,
            }),
          },
          {
            type: "image",
            image: options.base64Image,
          },
        ],
      },
    ],
    abortSignal: options.signal,
  });

  if (!result.text.trim()) {
    return [];
  }

  const parsed = parseJsonTextWithSchema(
    result.text,
    formFieldResponseSchema,
    "Form detection",
  );

  return parsed.fields.map((item, index) => {
    const [ymin, xmin, ymax, xmax] = item.box_2d;
    const yMinVal = clampBoxCoordinate(ymin);
    const xMinVal = clampBoxCoordinate(xmin);
    const yMaxVal = clampBoxCoordinate(ymax);
    const xMaxVal = clampBoxCoordinate(xmax);

    const x = (xMinVal / 1000) * options.pageWidth;
    const y = (yMinVal / 1000) * options.pageHeight;
    const width = ((xMaxVal - xMinVal) / 1000) * options.pageWidth;
    const height = ((yMaxVal - yMinVal) / 1000) * options.pageHeight;

    const fieldType = normalizeFieldType(item.type);
    const rawLabel = item.label.trim() || `Field_${index}`;
    const style: FieldStyle = { ...DEFAULT_FIELD_STYLE, textColor: "#000000" };

    if (item.visual_characteristics) {
      const backgroundColor = item.visual_characteristics.background_color;
      if (backgroundColor) {
        const normalized = backgroundColor.toLowerCase();
        if (
          normalized === "transparent" ||
          normalized === "#ffffff" ||
          normalized === "#fff"
        ) {
          style.isTransparent = true;
        } else {
          style.backgroundColor = backgroundColor;
          style.isTransparent = false;
        }
      }

      if (item.visual_characteristics.border_color) {
        style.borderColor = item.visual_characteristics.border_color;
      }

      const borderWidth = Number(item.visual_characteristics.border_width);
      if (Number.isFinite(borderWidth)) {
        style.borderWidth = borderWidth;
      }

      const fontSize = Number(item.visual_characteristics.font_size);
      if (Number.isFinite(fontSize) && fontSize > 0) {
        style.fontSize = fontSize;
      }
    }

    const dropdownOptions =
      fieldType === FieldType.DROPDOWN
        ? item.options?.filter((value) => value.trim().length > 0) || [
            "Option 1",
            "Option 2",
          ]
        : undefined;

    return {
      id: `auto_${options.pageIndex}_${index}_${Date.now()}`,
      pageIndex: options.pageIndex,
      type: fieldType,
      name: normalizeFieldLabel(rawLabel, index),
      rect: { x, y, width, height },
      required: false,
      style,
      options: dropdownOptions,
      radioValue: fieldType === FieldType.RADIO ? "Choice1" : undefined,
      multiline:
        fieldType === FieldType.TEXT
          ? item.text_preferences?.multiline
          : undefined,
      alignment:
        fieldType === FieldType.TEXT
          ? item.text_preferences?.alignment
          : undefined,
    } satisfies FormField;
  });
};
