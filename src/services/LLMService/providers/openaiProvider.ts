import OpenAI from "openai";

import { DEFAULT_FIELD_STYLE } from "@/constants";
import type { FieldStyle, FormField } from "@/types";
import { FieldType } from "@/types";
import { useEditorStore } from "@/store/useEditorStore";

import type {
  LLMAnalyzePageForFieldsOptions,
  LLMModelOption,
  LLMProvider,
  LLMTranslateTextOptions,
} from "../types";

const getOpenAiApiKey = () => {
  return (useEditorStore.getState().options?.llm?.openai?.apiKey || "").trim();
};

const getOpenAiApiUrl = () => {
  return (useEditorStore.getState().options?.llm?.openai?.apiUrl || "").trim();
};

const isOpenAiAvailable = () => {
  return !!getOpenAiApiKey();
};

const getClient = () => {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("Missing OpenAI API key.");
  }
  const baseURL = getOpenAiApiUrl();
  return new OpenAI({
    apiKey,
    dangerouslyAllowBrowser: true,
    ...(baseURL ? { baseURL } : {}),
  });
};

const normalizeOpenAiModelLabel = (id: string) => {
  return id;
};

export type OpenAiPageTranslateBlock = {
  id: string;
  order: number;
  text: string;
  maxChars?: number;
};

export type OpenAiPageTranslateResponse = {
  translations: Array<{
    id: string;
    action: "translate" | "skip";
    translatedText?: string | null;
  }>;
};

export const translateOpenAiPageBlocksStructured = async (options: {
  blocks: OpenAiPageTranslateBlock[];
  context?: Array<{ pageIndex: number; text: string }>;
  targetLanguage: string;
  sourceLanguage?: string;
  model?: string;
  prompt?: string;
  usePositionAwarePrompt?: boolean;
  aiReflowParagraphs?: boolean;
  signal?: AbortSignal;
}): Promise<OpenAiPageTranslateResponse> => {
  const client = getClient();
  const model = await resolveTranslateModelId(options.model);

  const extra = (options.prompt || "").trim();
  const lineBreakRule = options.aiReflowParagraphs
    ? "- You MAY reflow paragraphs within each block: treat PDF/text-layer line breaks as layout artifacts unless they are clearly intentional paragraph breaks. Prefer natural sentences and remove unnecessary mid-sentence line breaks. Do NOT add extra line breaks; only keep or add line breaks when truly necessary."
    : "- Preserve existing line breaks within each block. Do NOT add extra line breaks.";
  const positionAware = options.usePositionAwarePrompt
    ? "\n- Each block may include a maxChars hint. Prefer translations that fit within maxChars."
    : "";

  const payloadBlocks = options.blocks.map((b) => ({
    id: b.id,
    order: b.order,
    text: b.text,
    ...(options.usePositionAwarePrompt && typeof b.maxChars === "number"
      ? { maxChars: b.maxChars }
      : null),
  }));

  const prompt = `
You are a professional translator.

Task:
- Translate the target page blocks to ${options.targetLanguage}.
- You may SKIP blocks that are not meaningful to translate (e.g. pure symbols, page numbers).
- Preserve meaning.
${lineBreakRule}
- Output MUST be valid JSON. No markdown.
${positionAware}

Output JSON schema:
{
  "translations": [
    {
      "id": string,
      "action": "translate" | "skip",
      "translatedText"?: string | null
    }
  ]
}

${extra ? `Additional instructions:\n${extra}\n` : ""}

Input JSON:
${JSON.stringify(
  {
    target: {
      blocks: payloadBlocks,
    },
    context: options.context ?? [],
  },
  null,
  2,
)}
`.trim();

  const response = await client.chat.completions.create(
    {
      model,
      messages: [
        {
          role: "system",
          content:
            "Return only JSON. Do not wrap in markdown fences. Do not add commentary.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    },
    options.signal ? { signal: options.signal } : undefined,
  );

  const content = response.choices?.[0]?.message?.content;
  if (!content) return { translations: [] };

  const parsed = extractJsonObject(content) as unknown;
  if (!parsed || typeof parsed !== "object") return { translations: [] };

  const translations = (parsed as { translations?: unknown }).translations;
  if (!Array.isArray(translations)) return { translations: [] };

  const safe = translations
    .map((t) => {
      if (!t || typeof t !== "object") return null;
      const id = (t as { id?: unknown }).id;
      const action = (t as { action?: unknown }).action;
      const translatedText = (t as { translatedText?: unknown }).translatedText;
      if (typeof id !== "string") return null;
      if (action !== "translate" && action !== "skip") return null;
      return {
        id,
        action,
        translatedText:
          typeof translatedText === "string" ? translatedText : null,
      } as const;
    })
    .filter(Boolean) as OpenAiPageTranslateResponse["translations"];

  return { translations: safe };
};

let cachedTranslateModels: LLMModelOption[] = [];
let cachedVisionModels: LLMModelOption[] = [];
let refreshPromise: Promise<void> | null = null;
let refreshEpoch = 0;

export const resetOpenAiModelCache = () => {
  refreshEpoch += 1;
  cachedTranslateModels = [];
  cachedVisionModels = [];
  refreshPromise = null;
};

export const getOpenAiCachedModels = () => {
  return {
    translate: cachedTranslateModels,
    vision: cachedVisionModels,
  };
};

export const checkOpenAiConfig = async () => {
  if (!isOpenAiAvailable()) {
    throw new Error("Missing OpenAI API key.");
  }

  const client = getClient();
  for await (const _m of client.models.list()) {
    break;
  }
};

const mergeModels = (a: LLMModelOption[], b: LLMModelOption[]) => {
  const out: LLMModelOption[] = [];
  const seen = new Set<string>();

  for (const m of [...a, ...b]) {
    if (!m?.id) continue;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }

  return out;
};

const getCustomTranslateModels = (): LLMModelOption[] => {
  const ids =
    useEditorStore.getState().options?.llm?.openai?.customTranslateModels;
  if (!Array.isArray(ids)) return [];
  return ids
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .map((id) => ({ id, label: normalizeOpenAiModelLabel(id) }));
};

const getCustomVisionModels = (): LLMModelOption[] => {
  const ids =
    useEditorStore.getState().options?.llm?.openai?.customVisionModels;
  if (!Array.isArray(ids)) return [];
  return ids
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .map((id) => ({ id, label: normalizeOpenAiModelLabel(id) }));
};

const refreshModels = async () => {
  if (!isOpenAiAvailable()) {
    refreshEpoch += 1;
    cachedTranslateModels = [];
    cachedVisionModels = [];
    return;
  }
  if (cachedTranslateModels.length > 0) return;
  if (refreshPromise) return await refreshPromise;

  const epoch = refreshEpoch;

  refreshPromise = (async () => {
    if (!isOpenAiAvailable()) {
      if (refreshEpoch === epoch) {
        cachedTranslateModels = [];
        cachedVisionModels = [];
      }
      return;
    }

    const client = getClient();
    const all: Array<{ id: string }> = [];
    for await (const m of client.models.list()) {
      if (m?.id) all.push({ id: m.id });
    }

    const translate = all
      .map((m) => m.id)
      .sort()
      .map((id) => ({ id, label: normalizeOpenAiModelLabel(id) }));

    const vision = translate;

    if (refreshEpoch === epoch) {
      cachedTranslateModels = translate;
      cachedVisionModels = vision;
    }
  })().finally(() => {
    refreshPromise = null;
  });

  return await refreshPromise;
};

const resolveTranslateModelId = async (requested: string | undefined) => {
  await refreshModels();
  const candidate = typeof requested === "string" ? requested.trim() : "";
  if (candidate) return candidate;

  const fallback =
    cachedTranslateModels[0]?.id || getCustomTranslateModels()[0]?.id;
  if (!fallback) throw new Error("No available OpenAI models.");
  return fallback;
};

const resolveVisionModelId = async (requested: string | undefined) => {
  await refreshModels();
  const candidate = typeof requested === "string" ? requested.trim() : "";
  if (candidate) return candidate;

  const fallback = cachedVisionModels[0]?.id || getCustomVisionModels()[0]?.id;
  if (!fallback) {
    throw new Error("No available OpenAI vision-capable models.");
  }
  return fallback;
};

const extractJsonObject = (text: string): unknown => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fallback: best-effort extraction of a top-level JSON object
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Failed to parse JSON response.");
    return JSON.parse(match[0]);
  }
};

export const openaiProvider: LLMProvider = {
  id: "openai",
  label: "OpenAI (AI)",
  labelKey: "translate.provider_openai",
  unavailableMessageKey: "properties.ai_detection.api_key_missing",
  isAvailable: () => isOpenAiAvailable(),
  getFunctions: () => ({
    translate: {
      kind: "translate",
      getModels: () =>
        mergeModels(cachedTranslateModels, getCustomTranslateModels()),
      refreshModels,
      translateText: async (text: string, opts: LLMTranslateTextOptions) => {
        const client = getClient();
        const model = await resolveTranslateModelId(opts.modelId);

        const system =
          "You are a professional translator. Return ONLY the translated text.";

        const userPromptParts: string[] = [];
        if (opts.sourceLanguage) {
          userPromptParts.push(`Source language: ${opts.sourceLanguage}`);
        }
        userPromptParts.push(`Target language: ${opts.targetLanguage}`);
        if (opts.prompt) {
          userPromptParts.push(`Additional instructions: ${opts.prompt}`);
        }
        userPromptParts.push("Text to translate:");
        userPromptParts.push(text);

        const completion = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPromptParts.join("\n") },
          ],
        });

        const out = completion.choices?.[0]?.message?.content;
        return (out ?? "").trim();
      },
      translateTextStream: async function* (
        text: string,
        opts: LLMTranslateTextOptions,
      ) {
        const client = getClient();
        const model = await resolveTranslateModelId(opts.modelId);

        const system =
          "You are a professional translator. Stream the translated text.";

        const userPromptParts: string[] = [];
        if (opts.sourceLanguage) {
          userPromptParts.push(`Source language: ${opts.sourceLanguage}`);
        }
        userPromptParts.push(`Target language: ${opts.targetLanguage}`);
        if (opts.prompt) {
          userPromptParts.push(`Additional instructions: ${opts.prompt}`);
        }
        userPromptParts.push("Text to translate:");
        userPromptParts.push(text);

        const stream = await client.chat.completions.create({
          model,
          stream: true,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPromptParts.join("\n") },
          ],
        });

        for await (const chunk of stream) {
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            yield delta;
          }
        }
      },
    },
    aiDetect: {
      kind: "aiDetect",
      getModels: () => mergeModels(cachedVisionModels, getCustomVisionModels()),
      refreshModels,
      analyzePageForFields: async (
        base64Image,
        pageIndex,
        pageWidth,
        pageHeight,
        existingFields = [],
        options,
      ) => {
        const client = getClient();

        const typedExistingFields = existingFields as FormField[];
        const typedOptions = options as
          | LLMAnalyzePageForFieldsOptions
          | undefined;

        const model = await resolveVisionModelId(typedOptions?.modelId);

        const existingFieldsSummary = typedExistingFields.map((f) => ({
          id: f.id,
          type: f.type,
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

        const typeDescriptions: string[] = [];
        if (allowedTypes.includes(FieldType.TEXT)) {
          typeDescriptions.push(
            "Text Input Areas: Blank rectangles, underlines, or comb boxes.",
          );
        }
        if (allowedTypes.includes(FieldType.CHECKBOX)) {
          typeDescriptions.push(
            "Checkboxes: Small squares intended for ticking.",
          );
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
${typeDescriptions.map((desc, i) => `${i + 1}. ${desc}`).join("\n")}

Bounding Box Rules:
- Coordinates must be on a scale of 0 to 1000 (relative to image dimensions).
- 0 is the Top/Left edge, 1000 is the Bottom/Right edge.
- Format: [ymin, xmin, ymax, xmax]
- TIGHT FIT: The box must contain ONLY the fillable area.
- EXCLUDE LABELS: Do NOT include the label text in the box.

Naming Guidelines:
- Label: Provide a clean, human-readable label (e.g. "First Name", "Date").
- CLEAN TEXT ONLY: Do NOT include leading/trailing underscores, colons, or dots.

Visual Style & Properties Estimation:
- Background: Only set a color if there is a DISTINCT colored fill. Otherwise "transparent".
- Border Width:
  * IF the field in the image ALREADY has a visible box/border: Set "border_width" to 0.
  * IF the field has NO visible border: Set "border_width" to 1.
- Border Color: Estimate border color if border_width > 0.
- Font Size: Estimate appropriate font size (pt) based on surrounding text height.
- Multiline (Text Fields): If the box is significantly taller than a single line of text, mark as multiline.
- Alignment (Text Fields): Infer text alignment.

Dropdown Options Inference:
- If a field is identified as a "dropdown", attempt to infer logical options based on the label or context.

Additional User Instructions:
${typedOptions?.extraPrompt || "None"}

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
`;

        const response = await client.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content:
                "Return only JSON. Do not wrap in markdown fences. Do not add commentary.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: base64Image,
                  },
                },
              ],
            },
          ],
          response_format: { type: "json_object" },
        });

        const content = response.choices?.[0]?.message?.content;
        if (!content) return [];

        const result = extractJsonObject(content) as { fields?: unknown };
        if (!result.fields || !Array.isArray(result.fields)) return [];

        return (result.fields as unknown[]).map(
          (item: unknown, index: number) => {
            const safe = item as {
              box_2d?: unknown;
              label?: unknown;
              type?: unknown;
              visual_characteristics?: unknown;
              text_preferences?: unknown;
              options?: unknown;
            };

            const box = Array.isArray(safe.box_2d) ? safe.box_2d : [];
            const [ymin, xmin, ymax, xmax] = box;

            const yMinVal = Math.max(0, Math.min(1000, Number(ymin)));
            const xMinVal = Math.max(0, Math.min(1000, Number(xmin)));
            const yMaxVal = Math.max(0, Math.min(1000, Number(ymax)));
            const xMaxVal = Math.max(0, Math.min(1000, Number(xmax)));

            const x = (xMinVal / 1000) * pageWidth;
            const y = (yMinVal / 1000) * pageHeight;
            const w = ((xMaxVal - xMinVal) / 1000) * pageWidth;
            const h = ((yMaxVal - yMinVal) / 1000) * pageHeight;

            const rawLabel =
              typeof safe.label === "string" && safe.label.trim()
                ? safe.label
                : `Field_${index}`;

            let cleanLabel = rawLabel.replace(
              /^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g,
              "",
            );
            cleanLabel = cleanLabel.replace(/[^a-zA-Z0-9]+/g, "_");
            if (!cleanLabel) cleanLabel = `Field_${index}`;

            let fieldType = FieldType.TEXT;
            if (safe.type === "checkbox") fieldType = FieldType.CHECKBOX;
            else if (safe.type === "radio") fieldType = FieldType.RADIO;
            else if (safe.type === "dropdown") fieldType = FieldType.DROPDOWN;
            else if (safe.type === "signature") fieldType = FieldType.SIGNATURE;

            const style: FieldStyle = { ...DEFAULT_FIELD_STYLE };

            if (safe.visual_characteristics) {
              const vc = safe.visual_characteristics as Record<string, unknown>;

              const backgroundColor = vc["background_color"];
              if (typeof backgroundColor === "string" && backgroundColor) {
                const bg = backgroundColor.toLowerCase();
                if (bg === "transparent" || bg === "#ffffff" || bg === "#fff") {
                  style.isTransparent = true;
                } else {
                  style.backgroundColor = backgroundColor;
                  style.isTransparent = false;
                }
              }

              const borderColor = vc["border_color"];
              if (typeof borderColor === "string" && borderColor) {
                style.borderColor = borderColor;
              }

              const borderWidth = vc["border_width"];
              if (typeof borderWidth === "number") {
                style.borderWidth = borderWidth;
              }

              const fontSize = vc["font_size"];
              if (
                typeof fontSize === "number" ||
                typeof fontSize === "string"
              ) {
                const parsed = Number(fontSize);
                if (Number.isFinite(parsed) && parsed > 0)
                  style.fontSize = parsed;
              }
            }

            style.textColor = "#000000";

            let multiline = undefined;
            let alignment: "left" | "center" | "right" | undefined = undefined;

            if (fieldType === FieldType.TEXT && safe.text_preferences) {
              const tp = safe.text_preferences as Record<string, unknown>;
              const ml = tp["multiline"];
              if (typeof ml === "boolean") multiline = ml;

              const align = tp["alignment"];
              if (align === "left" || align === "center" || align === "right") {
                alignment = align;
              }
            }

            return {
              id: `auto_${pageIndex}_${index}_${Date.now()}`,
              pageIndex,
              type: fieldType,
              name: cleanLabel,
              rect: { x, y, width: w, height: h },
              required: false,
              style,
              options:
                fieldType === FieldType.DROPDOWN
                  ? Array.isArray(safe.options) && safe.options.length > 0
                    ? (safe.options as string[])
                    : ["Option 1", "Option 2"]
                  : undefined,
              radioValue: fieldType === FieldType.RADIO ? "Choice1" : undefined,
              multiline,
              alignment,
            } satisfies FormField;
          },
        );
      },
    },
  }),
};
