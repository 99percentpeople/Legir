import type {
  AiSearchResultSummary,
  AiToolExecutionContext,
  AiToolExecutionResult,
  AiToolName,
} from "./types";
import { normalizeAiToolArgsDeep } from "./toolCase";
import type { LLMChatToolDefinition } from "@/services/LLMService/types";
import { z, type ZodTypeAny } from "zod";

type AiToolHandler = {
  definition: LLMChatToolDefinition;
  execute: (
    args: unknown,
    ctx: AiToolExecutionContext,
    signal?: AbortSignal,
  ) => Promise<AiToolExecutionResult>;
};

const defineTool = (
  accessType: LLMChatToolDefinition["accessType"],
  definition: Omit<LLMChatToolDefinition, "accessType">,
): LLMChatToolDefinition => ({
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

const positiveIntSchema = z.number().int().positive();
const pageNumbersSchema = z.array(positiveIntSchema);
const emptyObjectSchema = z.object({}).strict();
const annotationTypesSchema = z.array(
  z.enum(["comment", "highlight", "ink", "freetext"]),
);
const stringArraySchema = z.array(z.string());

const getDocumentDigestArgsSchema = z
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

const readPagesArgsSchema = z
  .object({
    page_numbers: pageNumbersSchema.min(1),
    include_layout: z.boolean().optional().default(false),
  })
  .strict();

const searchDocumentArgsSchema = z
  .object({
    query: z.string().min(1),
    mode: z.enum(["plain", "regex"]).optional().default("plain"),
    regex_flags: z.string().optional(),
    page_numbers: pageNumbersSchema.optional().default([]),
    case_sensitive: z.boolean().optional().default(false),
    max_results: positiveIntSchema.optional().default(20),
  })
  .strict();

const listAnnotationsArgsSchema = z
  .object({
    query: z.string().optional(),
    page_numbers: pageNumbersSchema.optional().default([]),
    types: annotationTypesSchema.optional().default([]),
    max_results: positiveIntSchema.optional().default(100),
  })
  .strict();

const listFormFieldsArgsSchema = z
  .object({
    page_numbers: pageNumbersSchema.optional().default([]),
    query: z.string().optional(),
    only_empty: z.boolean().optional().default(false),
    include_read_only: z.boolean().optional().default(false),
    max_results: positiveIntSchema.optional().default(100),
  })
  .strict();

const fillFormFieldsArgsSchema = z
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

const focusFieldArgsSchema = z
  .object({
    field_id: z.string().min(1),
  })
  .strict();

const navigatePageArgsSchema = z
  .object({
    page_number: positiveIntSchema,
  })
  .strict();

const focusResultArgsSchema = z
  .object({
    result_id: z.string().min(1),
  })
  .strict();

const selectionAttachmentAnchorSchema = z
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

const documentAnchorSchema = z
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

const highlightResultsArgsSchema = z
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

const parseToolArgs = <T extends ZodTypeAny>(
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

const summarizeSearchResults = (results: AiSearchResultSummary[]) => {
  if (results.length === 0) return "0 results";
  const first = results[0];
  return `Found ${results.length} result${results.length === 1 ? "" : "s"}${first ? `, first on page ${first.pageNumber}` : ""}`;
};

const summarizeListedFormFields = (total: number, returned: number) => {
  if (returned === 0) return "Listed 0 form fields";
  if (returned === total) {
    return `Listed ${returned} form field${returned === 1 ? "" : "s"}`;
  }
  return `Listed ${returned} of ${total} form fields`;
};

const summarizeListedAnnotations = (total: number, returned: number) => {
  if (returned === 0) return "Listed 0 annotations";
  if (returned === total) {
    return `Listed ${returned} annotation${returned === 1 ? "" : "s"}`;
  }
  return `Listed ${returned} of ${total} annotations`;
};

const createErrorPayload = (code: string, message: string) => ({
  ok: false,
  error: code,
  message,
});

const createInvalidArgumentsResult = (
  toolName: AiToolName,
  message: string,
): AiToolExecutionResult => ({
  payload: createErrorPayload("INVALID_ARGUMENTS", message),
  summary: `${toolName} failed: invalid arguments`,
});

export const createAiToolRegistry = (ctx: AiToolExecutionContext) => {
  const handlers: Record<AiToolName, AiToolHandler> = {
    get_document_context: {
      definition: defineTool("read", {
        name: "get_document_context",
        description:
          "Get lightweight runtime context for the currently opened PDF document.",
        inputSchema: emptyObjectSchema,
      }),
      execute: async () => {
        const payload = ctx.documentContextService.getDocumentContext();
        return {
          payload,
          summary: `Context for ${payload.filename}, ${payload.pageCount} pages`,
        };
      },
    },

    get_document_metadata: {
      definition: defineTool("read", {
        name: "get_document_metadata",
        description:
          "Get PDF document metadata such as title, author, subject, keywords, creator, producer, and creation/modification dates.",
        inputSchema: emptyObjectSchema,
      }),
      execute: async () => {
        const payload = ctx.documentContextService.getDocumentMetadata();
        const availableKeys = Object.entries(payload).filter(([, value]) => {
          if (Array.isArray(value)) return value.length > 0;
          return value !== undefined && value !== null && value !== "";
        }).length;
        return {
          payload,
          summary: `Metadata with ${availableKeys} populated field${availableKeys === 1 ? "" : "s"}`,
        };
      },
    },

    get_document_digest: {
      definition: defineTool("read", {
        name: "get_document_digest",
        description:
          "Get a compact digest for exactly one contiguous page range. start_page and end_page are required, and each call summarizes only that range. For whole-document summaries, split the document into multiple ranges, call this tool in parallel when useful, then combine the results yourself. Optionally pass summary_instructions to tell the digest summarizer what to focus on.",
        inputSchema: getDocumentDigestArgsSchema,
      }),
      execute: async (rawArgs, _ctx, signal) => {
        const parsed = parseToolArgs(getDocumentDigestArgsSchema, rawArgs);
        if (parsed.success === false) {
          return createInvalidArgumentsResult(
            "get_document_digest",
            parsed.error,
          );
        }

        const args = parsed.data;
        const digest = await ctx.documentContextService.getDocumentDigest({
          startPage: args.start_page,
          endPage: args.end_page,
          charsPerChunk: args.chars_per_chunk,
          sourceCharsPerChunk: args.source_chars_per_chunk,
          summaryInstructions: args.summary_instructions?.trim() || undefined,
          signal,
        });

        return {
          payload: digest,
          summary: `${digest.mode === "ai_summary" ? "AI digest" : "Digest"} covers ${digest.returnedPageCount} page${digest.returnedPageCount === 1 ? "" : "s"} in ${digest.chunkCount} chunk${digest.chunkCount === 1 ? "" : "s"}`,
        };
      },
    },

    read_pages: {
      definition: defineTool("read", {
        name: "read_pages",
        description:
          "Read full text for one or more pages. Optionally include per-line layout rectangles. Returns at most 5 pages per call.",
        inputSchema: readPagesArgsSchema,
      }),
      execute: async (rawArgs, _ctx, signal) => {
        const parsed = parseToolArgs(readPagesArgsSchema, rawArgs);
        if (parsed.success === false) {
          return createInvalidArgumentsResult("read_pages", parsed.error);
        }

        const { page_numbers, include_layout } = parsed.data;
        const result = await ctx.documentContextService.readPages({
          pageNumbers: page_numbers,
          includeLayout: include_layout,
          signal,
        });

        return {
          payload: result,
          summary: result.truncated
            ? `Read ${result.returnedPageCount} of ${result.requestedPageCount} requested pages (limit ${result.maxPagesPerCall})`
            : `Read ${result.returnedPageCount} page${result.returnedPageCount === 1 ? "" : "s"}`,
        };
      },
    },

    search_document: {
      definition: defineTool("read", {
        name: "search_document",
        description:
          "Search the current document and return result ids that can be focused or highlighted later. Supports plain substring search and regex search for flexible whitespace or token patterns.",
        inputSchema: searchDocumentArgsSchema,
      }),
      execute: async (rawArgs, _ctx, signal) => {
        const parsed = parseToolArgs(searchDocumentArgsSchema, rawArgs);
        if (parsed.success === false) {
          return createInvalidArgumentsResult("search_document", parsed.error);
        }

        const args = parsed.data;
        const query = args.query.trim();
        if (!query) {
          return {
            payload: createErrorPayload(
              "INVALID_QUERY",
              "search_document requires a non-empty query string.",
            ),
            summary: "search_document failed: empty query",
          };
        }

        const results = await ctx.documentContextService.searchDocument({
          query,
          mode: args.mode,
          regexFlags: args.regex_flags?.trim() || undefined,
          pageNumbers: args.page_numbers,
          caseSensitive: args.case_sensitive,
          maxResults: args.max_results,
          signal,
        });
        const remembered = ctx.rememberSearchResults(query, results);

        return {
          payload: {
            query,
            total: remembered.length,
            results: remembered,
          },
          summary: summarizeSearchResults(remembered),
        };
      },
    },

    list_annotations: {
      definition: defineTool("read", {
        name: "list_annotations",
        description:
          "List existing annotations in the current document, including comments and highlights. Use this to read user notes or AI-created highlights.",
        inputSchema: listAnnotationsArgsSchema,
      }),
      execute: async (rawArgs) => {
        const parsed = parseToolArgs(listAnnotationsArgsSchema, rawArgs);
        if (parsed.success === false) {
          return createInvalidArgumentsResult("list_annotations", parsed.error);
        }

        const args = parsed.data;
        const result = ctx.listAnnotations({
          query: args.query?.trim() || undefined,
          pageNumbers: args.page_numbers,
          types: args.types,
          maxResults: args.max_results,
        });

        return {
          payload: result,
          summary: summarizeListedAnnotations(result.total, result.returned),
        };
      },
    },

    list_form_fields: {
      definition: defineTool("read", {
        name: "list_form_fields",
        description:
          "List existing PDF form fields that the AI can inspect before filling. Returns field ids, types, page numbers, current values, and available options.",
        inputSchema: listFormFieldsArgsSchema,
      }),
      execute: async (rawArgs) => {
        const parsed = parseToolArgs(listFormFieldsArgsSchema, rawArgs);
        if (parsed.success === false) {
          return createInvalidArgumentsResult("list_form_fields", parsed.error);
        }

        const args = parsed.data;
        const result = ctx.listFormFields({
          pageNumbers: args.page_numbers,
          query: args.query?.trim() || undefined,
          onlyEmpty: args.only_empty,
          includeReadOnly: args.include_read_only,
          maxResults: args.max_results,
        });

        return {
          payload: result,
          summary: summarizeListedFormFields(result.total, result.returned),
        };
      },
    },

    fill_form_fields: {
      definition: defineTool("write", {
        name: "fill_form_fields",
        description:
          "Fill existing PDF form fields by id. Supports text, dropdown, checkbox, and radio fields. Use list_form_fields first when ids or options are unclear.",
        inputSchema: fillFormFieldsArgsSchema,
      }),
      execute: async (rawArgs) => {
        const parsed = parseToolArgs(fillFormFieldsArgsSchema, rawArgs);
        if (parsed.success === false) {
          return createInvalidArgumentsResult("fill_form_fields", parsed.error);
        }

        const updates = parsed.data.updates.map((item) => ({
          fieldId: item.field_id.trim(),
          ...(item.value !== undefined ? { value: item.value } : null),
          ...(typeof item.checked === "boolean"
            ? { checked: item.checked }
            : null),
        }));

        const result = ctx.fillFormFields({ updates });
        return {
          payload: result,
          summary:
            result.rejectedCount > 0
              ? `Filled ${result.updatedCount} field${result.updatedCount === 1 ? "" : "s"}, ${result.rejectedCount} rejected`
              : `Filled ${result.updatedCount} field${result.updatedCount === 1 ? "" : "s"}`,
        };
      },
    },

    focus_field: {
      definition: defineTool("write", {
        name: "focus_field",
        description:
          "Focus an existing form field by id and scroll it into view.",
        inputSchema: focusFieldArgsSchema,
      }),
      execute: async (rawArgs) => {
        const parsed = parseToolArgs(focusFieldArgsSchema, rawArgs);
        if (parsed.success === false) {
          return createInvalidArgumentsResult("focus_field", parsed.error);
        }

        const fieldId = parsed.data.field_id.trim();
        const field = fieldId ? ctx.focusField(fieldId) : null;
        if (!field) {
          return {
            payload: createErrorPayload(
              "FIELD_NOT_FOUND",
              "focus_field requires a valid field_id from list_form_fields.",
            ),
            summary: "focus_field failed: field not found",
          };
        }

        return {
          payload: {
            ok: true,
            field,
          },
          summary: `Focused field on page ${field.pageNumber}`,
        };
      },
    },

    navigate_page: {
      definition: defineTool("write", {
        name: "navigate_page",
        description: "Scroll the workspace to the top of a specific page.",
        inputSchema: navigatePageArgsSchema,
      }),
      execute: async (rawArgs) => {
        const parsed = parseToolArgs(navigatePageArgsSchema, rawArgs);
        if (parsed.success === false) {
          return createInvalidArgumentsResult("navigate_page", parsed.error);
        }

        const { page_number } = parsed.data;

        ctx.navigatePage(page_number - 1);
        return {
          payload: {
            ok: true,
            pageNumber: page_number,
          },
          summary: `Navigated to page ${page_number}`,
        };
      },
    },

    focus_result: {
      definition: defineTool("write", {
        name: "focus_result",
        description:
          "Scroll the workspace to a previously returned search result id.",
        inputSchema: focusResultArgsSchema,
      }),
      execute: async (rawArgs) => {
        const parsed = parseToolArgs(focusResultArgsSchema, rawArgs);
        if (parsed.success === false) {
          return createInvalidArgumentsResult("focus_result", parsed.error);
        }

        const resultId = parsed.data.result_id.trim();
        const stored = resultId ? ctx.getStoredSearchResult(resultId) : null;
        if (!stored) {
          return {
            payload: createErrorPayload(
              "RESULT_NOT_FOUND",
              "focus_result requires a valid result_id from search_document.",
            ),
            summary: "focus_result failed: result not found",
          };
        }

        ctx.focusSearchResult(stored.result);
        return {
          payload: {
            ok: true,
            resultId,
            pageNumber: stored.result.pageIndex + 1,
          },
          summary: `Focused result on page ${stored.result.pageIndex + 1}`,
        };
      },
    },

    highlight_results: {
      definition: defineTool("write", {
        name: "highlight_results",
        description:
          "Create actual highlight annotations from previously returned search result ids, directly from the latest message's selection attachments, or directly from document text anchors using start_anchor and inclusive end_inclusive_anchor. Use top-level annotation_text as a shared note/comment fallback, or set annotation_text on individual selection_anchors or document_anchors when each highlight needs different note/comment text.",
        inputSchema: highlightResultsArgsSchema,
      }),
      execute: async (rawArgs) => {
        const parsed = parseToolArgs(highlightResultsArgsSchema, rawArgs);
        if (parsed.success === false) {
          return createInvalidArgumentsResult(
            "highlight_results",
            parsed.error,
          );
        }

        const resultIds = parsed.data.result_ids.map((id) => id.trim());
        const annotationText = parsed.data.annotation_text?.trim() || undefined;
        const selectionAnchors = parsed.data.selection_anchors.map((range) => ({
          attachmentIndex: range.attachment_index,
          startAnchor: range.start_anchor.trim(),
          endInclusiveAnchor: range.end_inclusive_anchor.trim(),
          annotationText: range.annotation_text?.trim() || undefined,
        }));
        const documentAnchors = parsed.data.document_anchors.map((range) => ({
          startAnchor: range.start_anchor.trim(),
          endInclusiveAnchor: range.end_inclusive_anchor.trim(),
          pageHint: range.page_hint,
          annotationText: range.annotation_text?.trim() || undefined,
        }));

        const hasAnyValidId = resultIds.some((id) =>
          ctx.getStoredSearchResult(id),
        );
        const hasAnyDirectSelectionTarget = selectionAnchors.length > 0;
        const hasAnyDirectDocumentTarget = documentAnchors.length > 0;
        if (
          resultIds.length > 0 &&
          !hasAnyValidId &&
          !hasAnyDirectSelectionTarget &&
          !hasAnyDirectDocumentTarget
        ) {
          return {
            payload: createErrorPayload(
              "RESULT_NOT_FOUND",
              "No provided result_ids, selection_anchors, or document_anchors were found in the current chat session.",
            ),
            summary: "highlight_results failed: result not found",
          };
        }

        const result = await ctx.createSearchHighlightAnnotations({
          ...(resultIds.length > 0 ? { resultIds } : null),
          ...(annotationText ? { annotationText } : null),
          ...(selectionAnchors.length > 0 ? { selectionAnchors } : null),
          ...(documentAnchors.length > 0 ? { documentAnchors } : null),
        });
        return {
          payload: result,
          summary:
            result.createdCount > 0
              ? result.skippedExistingCount > 0 || result.missingCount > 0
                ? `Created ${result.createdCount} highlight annotation${result.createdCount === 1 ? "" : "s"}, ${result.skippedExistingCount} skipped, ${result.missingCount} missing`
                : `Created ${result.createdCount} highlight annotation${result.createdCount === 1 ? "" : "s"}`
              : "highlight_results completed with no new highlights",
        };
      },
    },

    clear_highlights: {
      definition: defineTool("write", {
        name: "clear_highlights",
        description:
          "Remove AI-created search highlight annotations from the workspace.",
        inputSchema: emptyObjectSchema,
      }),
      execute: async () => {
        const result = ctx.clearSearchHighlights();
        return {
          payload: {
            ok: true,
            ...result,
          },
          summary:
            result.clearedCount > 0
              ? `Cleared ${result.clearedCount} highlight annotation${result.clearedCount === 1 ? "" : "s"}`
              : "No AI highlights to clear",
        };
      },
    },
  };

  return {
    getDefinitions: (): LLMChatToolDefinition[] =>
      Object.values(handlers).map((handler) => handler.definition),
    execute: async (name: string, rawArgs: unknown, signal?: AbortSignal) => {
      const handler = handlers[name as AiToolName];
      if (!handler) {
        return {
          payload: createErrorPayload("UNKNOWN_TOOL", `Unknown tool: ${name}`),
          summary: `Unknown tool: ${name}`,
        };
      }

      return await handler.execute(rawArgs, ctx, signal);
    },
  };
};
