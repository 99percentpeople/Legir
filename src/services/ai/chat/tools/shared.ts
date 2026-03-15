import { z, type ZodTypeAny } from "zod";

import type {
  AiAnnotationKind,
  AiChatToolDefinition,
  AiSearchResultSummary,
  AiToolExecutionContext,
  AiToolExecutionResult,
  AiToolName,
} from "@/services/ai/chat/types";
import { normalizeAiToolArgsDeep } from "@/services/ai/chat/toolCase";

export type AiToolHandler = {
  definition: AiChatToolDefinition;
  execute: (
    args: unknown,
    ctx: AiToolExecutionContext,
    signal?: AbortSignal,
  ) => Promise<AiToolExecutionResult>;
};

export type AiToolHandlerMap<T extends AiToolName = AiToolName> = Partial<
  Record<T, AiToolHandler>
>;

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
export const pageNumbersSchema = z.array(positiveIntSchema);
export const emptyObjectSchema = z.object({}).strict();
export const annotationTypesSchema = z.array(
  z.enum(["comment", "highlight", "ink", "freetext"]),
);
export const stringArraySchema = z.array(z.string());

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
    summary_instructions: z
      .string()
      .optional()
      .describe(
        "Optional extra instructions passed to the digest summarizer, for example to focus on methods, risks, conclusions, or action items.",
      ),
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
    page_numbers: pageNumbersSchema.min(1),
    include_layout: z.boolean().optional().default(false),
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

export const updateAnnotationTextArgsSchema = z
  .object({
    annotation_id: z.string().min(1),
    text: z.string(),
  })
  .strict();

export const updateAnnotationTextsArgsSchema = z
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
  .strict();

export const listFormFieldsArgsSchema = z
  .object({
    page_numbers: pageNumbersSchema.optional().default([]),
    query: z.string().optional(),
    only_empty: z.boolean().optional().default(false),
    include_read_only: z.boolean().optional().default(false),
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

export const focusFieldArgsSchema = z
  .object({
    field_id: z.string().min(1),
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
  .strict()
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

export const highlightResultArgsSchema = z
  .object({
    result_id: z.string().min(1).optional(),
    annotation_text: z
      .string()
      .optional()
      .describe(
        "Optional note/comment text for the created highlight when it should differ from the highlighted source text.",
      ),
    selection_anchor: selectionAttachmentAnchorSchema.optional(),
    document_anchor: documentAnchorSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const targetCount =
      Number(Boolean(value.result_id)) +
      Number(Boolean(value.selection_anchor)) +
      Number(Boolean(value.document_anchor));
    if (targetCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Exactly one of result_id, selection_anchor, or document_anchor is required.",
      });
    }
  });

export const toAnnotationKinds = (types: readonly AiAnnotationKind[]) => [
  ...types,
];
