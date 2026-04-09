import { z, type ZodTypeAny } from "zod";

import type {
  AiAnnotationKind,
  AiChatToolDefinition,
  AiSearchResultSummary,
  AiToolExecutionProgress,
  AiToolExecutionResult,
  AiToolName,
} from "@/services/ai/chat/types";
import type { AiToolContext } from "@/services/ai/chat/aiToolContext";
import { normalizeAiToolArgsDeep } from "@/services/ai/utils/toolCase";

export type AiToolHandler = {
  definition: AiChatToolDefinition;
  execute: (
    args: unknown,
    ctx: AiToolContext,
    signal?: AbortSignal,
    onProgress?: (progress: AiToolExecutionProgress) => void,
  ) => Promise<AiToolExecutionResult>;
};

export type AiToolHandlerMap<T extends AiToolName = AiToolName> = Partial<
  Record<T, AiToolHandler>
>;

export type AiToolModule<
  THandlers extends AiToolHandlerMap = AiToolHandlerMap,
> = {
  createHandlers: (ctx: AiToolContext) => THandlers;
};

export const defineToolModule = <THandlers extends AiToolHandlerMap>(
  createHandlers: AiToolModule<THandlers>["createHandlers"],
): AiToolModule<THandlers> => ({
  createHandlers,
});

export const createToolHandlerMap = (
  modules: readonly AiToolModule[],
  ctx: AiToolContext,
): AiToolHandlerMap => {
  const handlers: AiToolHandlerMap = {};

  for (const module of modules) {
    const moduleHandlers = module.createHandlers(ctx);

    for (const [name, handler] of Object.entries(moduleHandlers) as Array<
      [AiToolName, AiToolHandler | undefined]
    >) {
      if (!handler) continue;
      if (handlers[name]) {
        throw new Error(`Duplicate AI tool handler registered: ${name}`);
      }
      handlers[name] = handler;
    }
  }

  return handlers;
};

type AiToolBuilderState<
  TName extends AiToolName,
  TSchema extends ZodTypeAny,
> = {
  name: TName;
  enabled: boolean;
  accessType?: AiChatToolDefinition["accessType"];
  description?: string;
  inputSchema: TSchema;
  promptInstructions: string[];
  requiredInputModalities: NonNullable<
    AiChatToolDefinition["requiredInputModalities"]
  >;
  toModelOutput?: AiChatToolDefinition["toModelOutput"];
};

type AiToolBuilderExecuteOptions<TSchema extends ZodTypeAny> = {
  args: z.output<TSchema>;
  rawArgs: unknown;
  ctx: AiToolContext;
  signal?: AbortSignal;
  onProgress?: (progress: AiToolExecutionProgress) => void;
};

export const defineTool = (
  accessType: AiChatToolDefinition["accessType"],
  definition: Omit<AiChatToolDefinition, "accessType">,
): AiChatToolDefinition => ({
  accessType,
  ...definition,
});

const JSON_STRING_ESCAPE_CHARS = new Set([
  '"',
  "\\",
  "/",
  "b",
  "f",
  "n",
  "r",
  "t",
  "u",
]);

const isEscapedAt = (value: string, index: number) => {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (value[cursor] !== "\\") break;
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
};

const repairInvalidJsonStringEscapes = (value: string) => {
  let output = "";
  let inString = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;

    if (char === '"' && !isEscapedAt(value, index)) {
      inString = !inString;
      output += char;
      continue;
    }

    if (inString && char === "\\") {
      const next = value[index + 1];
      if (!next || !JSON_STRING_ESCAPE_CHARS.has(next)) {
        output += "\\\\";
        continue;
      }
    }

    output += char;
  }

  return output;
};

const parseArgsObject = (value: unknown) => {
  if (!value) return {};
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      return normalizeAiToolArgsDeep(
        JSON.parse(trimmed) as Record<string, unknown>,
      );
    } catch (error) {
      const repaired = repairInvalidJsonStringEscapes(trimmed);
      if (repaired !== trimmed) {
        try {
          return normalizeAiToolArgsDeep(
            JSON.parse(repaired) as Record<string, unknown>,
          );
        } catch {
          // fall through to original error below
        }
      }
      const message =
        error instanceof Error ? error.message : "Invalid JSON tool arguments.";
      throw new Error(
        `Invalid JSON tool arguments. ${message}. If you are using regex, escape backslashes in JSON strings, e.g. \\\\s* instead of \\s*.`,
      );
    }
  }
  if (typeof value === "object") {
    return normalizeAiToolArgsDeep(value as Record<string, unknown>);
  }
  throw new Error("Tool arguments must be a JSON object.");
};

const formatIssuePath = (path: Array<string | number>) =>
  path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : segment))
    .join(".");

const formatToolArgsError = (error: unknown) => {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => {
        const path = formatIssuePath(issue.path);
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; ");
  }

  return error instanceof Error ? error.message : "Invalid tool arguments.";
};

export const parseToolArgs = <T extends ZodTypeAny>(
  schema: T,
  value: unknown,
): { success: true; data: z.output<T> } | { success: false; error: string } => {
  try {
    const parsed = schema.safeParse(parseArgsObject(value));
    if (parsed.success) {
      return { success: true as const, data: parsed.data as z.output<T> };
    }
    return {
      success: false as const,
      error: formatToolArgsError(parsed.error),
    };
  } catch (error) {
    return { success: false as const, error: formatToolArgsError(error) };
  }
};

export const createErrorPayload = (code: string, message: string) => ({
  ok: false,
  error: code,
  message,
});

export const createInvalidArgumentsResult = (
  toolName: AiToolName,
  message: string,
): AiToolExecutionResult => ({
  payload: createErrorPayload("INVALID_ARGUMENTS", message),
  summary: `${toolName} failed: invalid arguments`,
});

export const summarizeSearchResults = (results: AiSearchResultSummary[]) => {
  if (results.length === 0) return "0 results";
  const first = results[0];
  return `Found ${results.length} result${results.length === 1 ? "" : "s"}${first ? `, first on page ${first.pageNumber}` : ""}`;
};

export const summarizeListedFormFields = (total: number, returned: number) => {
  if (returned === 0) return "Listed 0 form fields";
  if (returned === total) {
    return `Listed ${returned} form field${returned === 1 ? "" : "s"}`;
  }
  return `Listed ${returned} of ${total} form fields`;
};

export const summarizeListedAnnotations = (total: number, returned: number) => {
  if (returned === 0) return "Listed 0 annotations";
  if (returned === total) {
    return `Listed ${returned} annotation${returned === 1 ? "" : "s"}`;
  }
  return `Listed ${returned} of ${total} annotations`;
};

export const positiveIntSchema = z.number().int().positive();
const finiteNumberSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return value;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return value;
}, z.number().finite());
const nonNegativeNumberSchema = finiteNumberSchema.refine(
  (value) => value >= 0,
  {
    message: "Expected a non-negative number.",
  },
);
const positiveNumberSchema = finiteNumberSchema.refine((value) => value > 0, {
  message: "Expected a positive number.",
});
const pageNumberInputSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10);
    }
  }
  return value;
}, positiveIntSchema);
export const pageNumberSchema = pageNumberInputSchema;

const pageNumbersArraySchema = z.array(pageNumberInputSchema);

export const pageNumbersSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}, pageNumbersArraySchema);
export const requiredPageNumbersSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}, pageNumbersArraySchema.min(1));
export const emptyObjectSchema = z.object({}).strict();

const createConfiguredToolBuilder = <
  TName extends AiToolName,
  TSchema extends ZodTypeAny,
>(
  state: AiToolBuilderState<TName, TSchema>,
) => ({
  enable: (enabled: boolean) =>
    createConfiguredToolBuilder({
      ...state,
      enabled,
    }),
  read: () =>
    createConfiguredToolBuilder({
      ...state,
      accessType: "read" as const,
    }),
  write: () =>
    createConfiguredToolBuilder({
      ...state,
      accessType: "write" as const,
    }),
  description: (description: string) =>
    createConfiguredToolBuilder({
      ...state,
      description,
    }),
  promptInstructions: (instructions: readonly string[]) =>
    createConfiguredToolBuilder({
      ...state,
      promptInstructions: instructions.map((instruction) => instruction.trim()),
    }),
  requiresInputModalities: (
    requiredInputModalities: NonNullable<
      AiChatToolDefinition["requiredInputModalities"]
    >,
  ) =>
    createConfiguredToolBuilder({
      ...state,
      requiredInputModalities: requiredInputModalities.map((modality) =>
        modality.trim().toLowerCase(),
      ),
    }),
  toModelOutput: (toModelOutput: AiChatToolDefinition["toModelOutput"]) =>
    createConfiguredToolBuilder({
      ...state,
      toModelOutput,
    }),
  inputSchema: <TNextSchema extends ZodTypeAny>(inputSchema: TNextSchema) =>
    createConfiguredToolBuilder<TName, TNextSchema>({
      ...state,
      inputSchema,
    }),
  build: (
    execute: (
      options: AiToolBuilderExecuteOptions<TSchema>,
    ) => Promise<AiToolExecutionResult> | AiToolExecutionResult,
  ): AiToolHandler | undefined => {
    if (!state.enabled) {
      return undefined;
    }
    if (!state.accessType) {
      throw new Error(`Tool ${state.name} is missing accessType.`);
    }
    if (!state.description?.trim()) {
      throw new Error(`Tool ${state.name} is missing description.`);
    }

    return {
      definition: defineTool(state.accessType, {
        name: state.name,
        description: state.description,
        inputSchema: state.inputSchema,
        promptInstructions: state.promptInstructions,
        requiredInputModalities: state.requiredInputModalities,
        toModelOutput: state.toModelOutput,
      }),
      execute: async (rawArgs, ctx, signal, onProgress) => {
        const parsed = parseToolArgs(state.inputSchema, rawArgs);
        if (parsed.success === false) {
          return createInvalidArgumentsResult(state.name, parsed.error);
        }

        return await execute({
          args: parsed.data,
          rawArgs,
          ctx,
          signal,
          onProgress,
        });
      },
    };
  },
});

export const createToolBuilder = <TName extends AiToolName>(name: TName) =>
  createConfiguredToolBuilder<TName, typeof emptyObjectSchema>({
    name,
    enabled: true,
    inputSchema: emptyObjectSchema,
    promptInstructions: [],
    requiredInputModalities: [],
  });

export const annotationTypesSchema = z.array(
  z.enum(["comment", "highlight", "ink", "freetext", "stamp", "shape", "link"]),
);
export const formFieldKindsSchema = z.array(
  z.enum(["text", "checkbox", "radio", "dropdown", "signature"]),
);
export const stringArraySchema = z.array(z.string());
export const summaryInstructionsSchema = z
  .object({
    known_information: z
      .string()
      .optional()
      .default("")
      .describe(
        "Facts, findings, or context already known from earlier tool calls.",
      ),
    remaining_uncertainties: z
      .string()
      .optional()
      .default("")
      .describe(
        "Open questions, ambiguities, or missing details that still need checking.",
      ),
    what_to_add_or_verify: z
      .string()
      .optional()
      .default("")
      .describe(
        "What this new summary should add, compare, confirm, or verify.",
      ),
  })
  .strict()
  .describe(
    "Optional structured guidance for summary tools. Use known_information, remaining_uncertainties, and what_to_add_or_verify instead of a free-form string.",
  );

export const getDocumentDigestArgsSchema = z
  .object({
    start_page: positiveIntSchema.describe(
      "Required 1-based start page for the exact contiguous range to summarize.",
    ),
    end_page: positiveIntSchema.describe(
      "Required 1-based end page for the exact contiguous range to summarize.",
    ),
    chars_per_chunk: positiveIntSchema.optional(),
    source_chars_per_chunk: positiveIntSchema.optional(),
    summary_instructions: summaryInstructionsSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      typeof value.start_page === "number" &&
      typeof value.end_page === "number" &&
      value.start_page > value.end_page
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "start_page must be less than or equal to end_page.",
        path: ["start_page"],
      });
    }
  });

export const readPagesArgsSchema = z
  .object({
    page_numbers: requiredPageNumbersSchema,
    include_layout: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true, also return per-line text with layout rectangles. Prefer true for tables, multi-column pages, or when preparing precise highlight anchors.",
      ),
  })
  .strict();

export const searchDocumentArgsSchema = z
  .object({
    query: z.string().min(1),
    mode: z.enum(["plain", "regex"]).optional().default("plain"),
    regex_flags: z.string().optional(),
    page_numbers: pageNumbersSchema.optional().default([]),
    case_sensitive: z.boolean().optional().default(false),
    max_results: positiveIntSchema.optional().default(20),
  })
  .strict();

export const listAnnotationsArgsSchema = z
  .object({
    query: z.string().optional(),
    page_numbers: pageNumbersSchema.optional().default([]),
    types: annotationTypesSchema.optional().default([]),
    max_results: positiveIntSchema.optional().default(100),
  })
  .strict();

export const updateAnnotationTextsArgsSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    const record = value as Record<string, unknown>;
    if ("updates" in record) return record;
    if (
      typeof record.annotation_id === "string" &&
      typeof record.text === "string"
    ) {
      return {
        updates: [
          {
            annotation_id: record.annotation_id,
            text: record.text,
          },
        ],
      };
    }
    return record;
  },
  z
    .object({
      updates: z
        .array(
          z
            .object({
              annotation_id: z.string().min(1),
              text: z.string(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
);

export const deleteAnnotationsArgsSchema = z.preprocess(
  (value) => value,
  z
    .object({
      annotation_ids: z
        .preprocess(
          (value) => (typeof value === "string" ? [value] : value),
          z.array(z.string().min(1)).min(1),
        )
        .describe(
          "One or more annotation ids to delete. Pass either a single id string or an array of id strings in the same annotation_ids field.",
        ),
    })
    .strict(),
);

export const listFormFieldsArgsSchema = z
  .object({
    page_numbers: pageNumbersSchema.optional().default([]),
    query: z.string().optional(),
    only_empty: z.boolean().optional().default(false),
    include_read_only: z.boolean().optional().default(false),
    include_layout: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true, also return each field's page-space rectangle. Prefer true when the user asks for field locations or when a later action needs visual targeting.",
      ),
    max_results: positiveIntSchema.optional().default(100),
  })
  .strict();

export const fillFormFieldsArgsSchema = z
  .object({
    updates: z
      .array(
        z
          .object({
            field_id: z.string().min(1),
            value: z.union([z.string(), stringArraySchema]).optional(),
            checked: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const formFieldAlignmentSchema = z.enum(["left", "center", "right"]);
const unitIntervalNumberSchema = finiteNumberSchema.refine(
  (value) => value >= 0 && value <= 1,
  {
    message: "Expected a number between 0 and 1.",
  },
);
const optionalFiniteNumberSchema = z.preprocess((value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return undefined;
}, z.number().finite().optional());
const optionalPositiveNumberSchema = z.preprocess((value) => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return undefined;
}, z.number().finite().positive().optional());
const optionalNonNegativeNumberSchema = z.preprocess((value) => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return numeric;
    }
  }
  return undefined;
}, z.number().finite().nonnegative().optional());
const optionalPageNumberSchema = z.preprocess((value) => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.trunc(numeric);
    }
  }
  return undefined;
}, z.number().int().positive().optional());
const optionalStringSchema = z.preprocess(
  (value) => (typeof value === "string" ? value : undefined),
  z.string().optional(),
);
const optionalTrimmedStringSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : undefined),
  z.string().optional(),
);
const optionalBooleanSchema = z.preprocess(
  (value) => (typeof value === "boolean" ? value : undefined),
  z.boolean().optional(),
);
export const pageRectArgsSchema = z
  .object({
    x: nonNegativeNumberSchema,
    y: nonNegativeNumberSchema,
    width: positiveNumberSchema,
    height: positiveNumberSchema,
  })
  .strict();
const loosePageRectArgsSchema = z
  .object({
    x: optionalFiniteNumberSchema,
    y: optionalFiniteNumberSchema,
    width: optionalPositiveNumberSchema,
    height: optionalPositiveNumberSchema,
  })
  .passthrough();
const looseAnnotationPointArgsSchema = z
  .object({
    x: optionalFiniteNumberSchema,
    y: optionalFiniteNumberSchema,
  })
  .passthrough();
const shapeArrowStyleSchema = z.enum([
  "closed_arrow",
  "line_arrow",
  "hollow_arrow",
  "circle",
  "square",
  "diamond",
  "slash",
]);
const formFieldRectPatchArgsSchema = z
  .object({
    x: nonNegativeNumberSchema.optional(),
    y: nonNegativeNumberSchema.optional(),
    width: positiveNumberSchema.optional(),
    height: positiveNumberSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.x === undefined &&
      value.y === undefined &&
      value.width === undefined &&
      value.height === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "rect must include at least one of x, y, width, or height when provided.",
      });
    }
  });

const annotationRectPatchArgsSchema = formFieldRectPatchArgsSchema;

const fieldStyleArgsSchema = z
  .object({
    border_color: z.string().min(1).optional(),
    background_color: z.string().min(1).optional(),
    border_width: nonNegativeNumberSchema.optional(),
    border_style: z.enum(["solid", "dashed", "underline"]).optional(),
    text_color: z.string().min(1).optional(),
    font_size: positiveNumberSchema.optional(),
    font_family: z.string().min(1).optional(),
    is_transparent: z.boolean().optional(),
  })
  .strict();

const updateFormFieldInputSchema = z
  .object({
    field_id: z.string().min(1),
    rect: formFieldRectPatchArgsSchema.optional(),
    required: z.boolean().optional(),
    read_only: z.boolean().optional(),
    tool_tip: z.string().optional(),
    placeholder: z.string().optional(),
    options: z.array(z.string()).min(1).optional(),
    multiline: z.boolean().optional(),
    alignment: formFieldAlignmentSchema.optional(),
    is_multi_select: z.boolean().optional(),
    allow_custom_value: z.boolean().optional(),
    export_value: z.string().optional(),
    style: fieldStyleArgsSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasStyleUpdate = !!value.style && Object.keys(value.style).length > 0;
    const hasRectUpdate = !!value.rect;
    const hasOtherUpdate =
      value.required !== undefined ||
      value.read_only !== undefined ||
      value.tool_tip !== undefined ||
      value.placeholder !== undefined ||
      value.options !== undefined ||
      value.multiline !== undefined ||
      value.alignment !== undefined ||
      value.is_multi_select !== undefined ||
      value.allow_custom_value !== undefined ||
      value.export_value !== undefined;

    if (!hasStyleUpdate && !hasRectUpdate && !hasOtherUpdate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each update must include at least one property to change.",
      });
    }
  });

export const updateFormFieldsArgsSchema = z
  .object({
    updates: z.array(updateFormFieldInputSchema).min(1),
  })
  .strict();

const sharedAnnotationStyleArgsSchema = z.object({
  color: z.string().min(1).optional(),
  opacity: unitIntervalNumberSchema.optional(),
});

const freetextAnnotationStyleArgsSchema = sharedAnnotationStyleArgsSchema
  .extend({
    background_color: z.string().min(1).optional(),
    border_color: z.string().min(1).optional(),
    border_width: nonNegativeNumberSchema.optional(),
    font_size: positiveNumberSchema.optional(),
    font_family: z.string().min(1).optional(),
    line_height: positiveNumberSchema.optional(),
    alignment: formFieldAlignmentSchema.optional(),
    flatten: z.boolean().optional(),
    rotation_deg: finiteNumberSchema.optional(),
  })
  .strict();

const shapeAnnotationStyleArgsSchema = sharedAnnotationStyleArgsSchema
  .extend({
    background_color: z.string().min(1).optional(),
    background_opacity: unitIntervalNumberSchema.optional(),
    thickness: nonNegativeNumberSchema.optional(),
    arrow_size: positiveNumberSchema.optional(),
    start_arrow_style: shapeArrowStyleSchema.optional(),
    end_arrow_style: shapeArrowStyleSchema.optional(),
    cloud_intensity: positiveNumberSchema.optional(),
    cloud_spacing: positiveNumberSchema.optional(),
  })
  .strict();

const ensureAnnotationPatchPayload = (
  value: {
    text?: string;
    rect?: unknown;
    style?: Record<string, unknown>;
  },
  ctx: z.RefinementCtx,
) => {
  const hasTextUpdate = value.text !== undefined;
  const hasRectUpdate = !!value.rect;
  const hasStyleUpdate = !!value.style && Object.keys(value.style).length > 0;

  if (!hasTextUpdate && !hasRectUpdate && !hasStyleUpdate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Each update must include at least one property to change.",
    });
  }
};

const highlightAnnotationUpdateInputSchema = z
  .object({
    annotation_id: z.string().min(1),
    text: z.string().optional(),
    rect: annotationRectPatchArgsSchema.optional(),
    style: sharedAnnotationStyleArgsSchema.strict().optional(),
  })
  .strict()
  .superRefine(ensureAnnotationPatchPayload);

const freetextAnnotationUpdateInputSchema = z
  .object({
    annotation_id: z.string().min(1),
    text: z.string().optional(),
    rect: annotationRectPatchArgsSchema.optional(),
    style: freetextAnnotationStyleArgsSchema.optional(),
  })
  .strict()
  .superRefine(ensureAnnotationPatchPayload);

const shapeAnnotationUpdateInputSchema = z
  .object({
    annotation_id: z.string().min(1),
    text: z.string().optional(),
    rect: annotationRectPatchArgsSchema.optional(),
    style: shapeAnnotationStyleArgsSchema.optional(),
  })
  .strict()
  .superRefine(ensureAnnotationPatchPayload);

const createSingleOrBatchAnnotationUpdateArgsSchema = <
  TSchema extends ZodTypeAny,
>(
  itemSchema: TSchema,
) =>
  z.preprocess(
    (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return value;
      }
      const record = value as Record<string, unknown>;
      if ("updates" in record) return record;
      if (typeof record.annotation_id === "string") {
        return { updates: [record] };
      }
      return record;
    },
    z
      .object({
        updates: z.array(itemSchema).min(1),
      })
      .strict(),
  );

export const updateHighlightAnnotationsArgsSchema =
  createSingleOrBatchAnnotationUpdateArgsSchema(
    highlightAnnotationUpdateInputSchema,
  );

export const updateFreetextAnnotationsArgsSchema =
  createSingleOrBatchAnnotationUpdateArgsSchema(
    freetextAnnotationUpdateInputSchema,
  );

export const updateShapeAnnotationsArgsSchema =
  createSingleOrBatchAnnotationUpdateArgsSchema(
    shapeAnnotationUpdateInputSchema,
  );

const createFreetextAnnotationInputSchema = z
  .object({
    page_number: optionalPageNumberSchema,
    text: optionalStringSchema,
    rect: loosePageRectArgsSchema.optional(),
    style: z
      .object({
        color: optionalTrimmedStringSchema,
        opacity: unitIntervalNumberSchema.optional().catch(undefined),
        background_color: optionalTrimmedStringSchema,
        border_color: optionalTrimmedStringSchema,
        border_width: optionalNonNegativeNumberSchema,
        font_size: optionalPositiveNumberSchema,
        font_family: optionalTrimmedStringSchema,
        line_height: optionalPositiveNumberSchema,
        alignment: formFieldAlignmentSchema.optional().catch(undefined),
        flatten: optionalBooleanSchema,
        rotation_deg: optionalFiniteNumberSchema,
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const createFreetextAnnotationsArgsSchema = z
  .object({
    annotations: z.array(createFreetextAnnotationInputSchema).min(1),
  })
  .strict();

const createShapeAnnotationInputSchema = z
  .object({
    page_number: optionalPageNumberSchema,
    shape_type: z
      .enum([
        "square",
        "circle",
        "line",
        "polyline",
        "polygon",
        "cloud_polygon",
        "arrow",
        "cloud",
      ])
      .optional()
      .catch(undefined),
    rect: loosePageRectArgsSchema.optional(),
    points: z.array(looseAnnotationPointArgsSchema).optional(),
    annotation_text: optionalStringSchema,
    style: z
      .object({
        color: optionalTrimmedStringSchema,
        opacity: unitIntervalNumberSchema.optional().catch(undefined),
        background_color: optionalTrimmedStringSchema,
        background_opacity: unitIntervalNumberSchema
          .optional()
          .catch(undefined),
        thickness: optionalNonNegativeNumberSchema,
        arrow_size: optionalPositiveNumberSchema,
        start_arrow_style: shapeArrowStyleSchema.optional().catch(undefined),
        end_arrow_style: shapeArrowStyleSchema.optional().catch(undefined),
        cloud_intensity: optionalPositiveNumberSchema,
        cloud_spacing: optionalPositiveNumberSchema,
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const createShapeAnnotationsArgsSchema = z
  .object({
    annotations: z.array(createShapeAnnotationInputSchema).min(1),
  })
  .strict();

export const detectFormFieldsArgsSchema = z
  .object({
    page_numbers: pageNumbersSchema.optional().default([]),
    allowed_types: formFieldKindsSchema.optional().default([]),
    user_intent: z
      .string()
      .optional()
      .describe(
        "Optional short intent summary for what the user wants to create, for example 'create the fillable fields on this page' or 'only detect signature and date areas'.",
      ),
    extra_prompt: z
      .string()
      .optional()
      .describe(
        "Optional extra constraints for detection, such as ignoring instructional text or focusing on a specific section.",
      ),
  })
  .strict();

const createFormFieldInputSchema = z
  .object({
    page_number: pageNumberSchema,
    name: z.string().trim().min(1),
    type: z.enum(["text", "checkbox", "radio", "dropdown", "signature"]),
    rect: pageRectArgsSchema,
    required: z.boolean().optional(),
    read_only: z.boolean().optional(),
    tool_tip: z.string().trim().min(1).optional(),
    placeholder: z.string().optional(),
    options: z.array(z.string()).optional().default([]),
    multiline: z.boolean().optional(),
    alignment: formFieldAlignmentSchema.optional(),
    is_multi_select: z.boolean().optional(),
    allow_custom_value: z.boolean().optional(),
    export_value: z.string().trim().min(1).optional(),
    style: fieldStyleArgsSchema.optional(),
  })
  .strict();

export const createFormFieldsArgsSchema = z
  .object({
    batch_id: z
      .string()
      .optional()
      .describe(
        "Optional detected-field batch id. If omitted, apply the most recent draft batch from this conversation.",
      ),
    draft_ids: z
      .preprocess(
        (value) => (typeof value === "string" ? [value] : value),
        z.array(z.string().min(1)).optional().default([]),
      )
      .describe(
        "Optional subset of detected draft ids to create. If omitted, create every draft field in the selected batch.",
      ),
    fields: z
      .array(createFormFieldInputSchema)
      .optional()
      .default([])
      .describe(
        "Optional direct field definitions in actual page coordinates. Use this when the current chat model has already inspected page visuals and is ready to create fields directly.",
      ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.fields.length > 0 &&
      (typeof value.batch_id === "string" || value.draft_ids.length > 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Pass either fields for direct creation or batch_id/draft_ids for a detected batch, not both.",
        path: ["fields"],
      });
    }
  });

export const focusControlArgsSchema = z
  .object({
    control_id: z.string().min(1),
    select: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true, also select the focused control in the workspace. Defaults to false to avoid switching the properties panel.",
      ),
  })
  .strict();

export const navigatePageArgsSchema = z
  .object({
    page_number: positiveIntSchema,
  })
  .strict();

export const focusResultArgsSchema = z
  .object({
    result_id: z.string().min(1),
  })
  .strict();

export const selectionAttachmentAnchorSchema = z
  .object({
    attachment_index: positiveIntSchema,
    start_anchor: z.string().min(1),
    end_inclusive_anchor: z.string().min(1),
    annotation_text: z
      .string()
      .optional()
      .describe(
        "Optional note/comment text for this specific selection highlight. Overrides the top-level annotation_text for this item only.",
      ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.end_inclusive_anchor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "end_inclusive_anchor is required.",
        path: ["end_inclusive_anchor"],
      });
    }
  });

export const documentAnchorSchema = z
  .object({
    start_anchor: z.string().min(1),
    end_inclusive_anchor: z.string().min(1),
    page_hint: positiveIntSchema.optional(),
    annotation_text: z
      .string()
      .optional()
      .describe(
        "Optional note/comment text for this specific document highlight. Overrides the top-level annotation_text for this item only.",
      ),
  })
  .strict();

export const highlightResultsArgsSchema = z
  .preprocess(
    (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return value;
      }
      const record = value as Record<string, unknown>;
      return {
        ...record,
        ...(record.result_id ? { result_ids: [record.result_id] } : null),
        ...(record.selection_anchor
          ? { selection_anchors: [record.selection_anchor] }
          : null),
        ...(record.document_anchor
          ? { document_anchors: [record.document_anchor] }
          : null),
      };
    },
    z
      .object({
        result_ids: z.array(z.string().min(1)).optional().default([]),
        annotation_text: z
          .string()
          .optional()
          .describe(
            "Optional shared note/comment text applied to created highlights that do not provide their own item-level annotation_text.",
          ),
        selection_anchors: z
          .array(selectionAttachmentAnchorSchema)
          .optional()
          .default([]),
        document_anchors: z.array(documentAnchorSchema).optional().default([]),
      })
      .strict(),
  )
  .superRefine((value, ctx) => {
    if (
      value.result_ids.length === 0 &&
      value.selection_anchors.length === 0 &&
      value.document_anchors.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "At least one result_id, selection_anchor, or document_anchor is required.",
      });
    }
  });

export const toAnnotationKinds = (types: readonly AiAnnotationKind[]) => [
  ...types,
];
