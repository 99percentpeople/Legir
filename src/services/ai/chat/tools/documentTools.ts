import { z } from "zod";
import {
  AI_CHAT_MAX_PAGE_IMAGES_PER_CALL,
  AI_CHAT_PAGE_IMAGE_PIXEL_DENSITY,
} from "@/constants";

import {
  createErrorPayload,
  createToolBuilder,
  defineToolModule,
  emptyObjectSchema,
  expandPageNumberSelectors,
  getDocumentDigestArgsSchema,
  summaryInstructionsSchema,
  pageNumberSchema,
  pageNumberSelectorSchema,
  pageRectArgsSchema,
  listAnnotationsArgsSchema,
  listFormFieldsArgsSchema,
  getPagesTextArgsSchema,
  searchDocumentArgsSchema,
  summarizeListedAnnotations,
  summarizeListedFormFields,
  summarizeSearchResults,
  type PageNumberSelector,
} from "./shared";
import { AI_PAGE_COORDINATE_CONVENTION } from "@/services/ai/utils/pageCoordinates";
import type {
  AiPageSpaceRect,
  AiRenderedPageImage,
  AiRenderedPageImageBatch,
  AiRenderedPageVisualSummaryResult,
} from "@/services/ai/chat/types";

type PageVisualRequestArg = number | { page: number; rect: AiPageSpaceRect };
type PageVisualTargetArg =
  | PageNumberSelector
  | Exclude<PageVisualRequestArg, number>;

const expandPageVisualTargets = (
  targets: readonly PageVisualTargetArg[],
): PageVisualRequestArg[] => {
  const out: PageVisualRequestArg[] = [];
  for (const target of targets) {
    if (Array.isArray(target)) {
      out.push(...expandPageNumberSelectors([target]));
      continue;
    }
    out.push(target);
  }
  return out;
};

const pageVisualTargetSchema = z.union([
  pageNumberSelectorSchema,
  z
    .object({
      page: pageNumberSchema.describe("1-based page number to render."),
      rect: pageRectArgsSchema.describe(
        "Page-space rectangle to crop from the rendered page image.",
      ),
    })
    .strict(),
]);
const pageVisualTargetsSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}, z.array(pageVisualTargetSchema).transform(expandPageVisualTargets));

const getPagesVisualArgsSchemaBase = z
  .object({
    pages: pageVisualTargetsSchema
      .optional()
      .default([])
      .describe(
        "Optional page visual requests. Each item may be a 1-based page number, a two-item inclusive range like [1, 22], or an object like { page, rect } to render a cropped page-space region. Defaults to the current page when omitted.",
      ),
    render_annotations: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "When true, include native PDF annotations in the rendered page image when supported by the PDF renderer.",
      ),
  })
  .strict();
const getPagesVisualArgsSchema = getPagesVisualArgsSchemaBase;

const summarizePagesVisualArgsSchemaBase = getPagesVisualArgsSchemaBase
  .extend({
    summary_instructions: summaryInstructionsSchema.optional(),
  })
  .strict();
const summarizePagesVisualArgsSchema = summarizePagesVisualArgsSchemaBase;

const toPagesVisualModelOutput = (output: unknown) => {
  if (!output || typeof output !== "object") {
    return {
      type: "text" as const,
      value: "Page visuals unavailable.",
    };
  }

  const batch = output as AiRenderedPageImageBatch;
  if (!Array.isArray(batch.pages) || batch.pages.length === 0) {
    return {
      type: "text" as const,
      value: "Page visuals unavailable.",
    };
  }

  const attachedPages = batch.pages.filter(
    (pageVisual): pageVisual is AiRenderedPageImage =>
      typeof pageVisual.base64Data === "string" &&
      !!pageVisual.base64Data &&
      typeof pageVisual.mimeType === "string" &&
      !!pageVisual.mimeType,
  );

  if (attachedPages.length === 0) {
    return {
      type: "text" as const,
      value: "Page visuals unavailable.",
    };
  }

  const content: Array<
    | { type: "text"; text: string }
    | {
        type: "image-data";
        data: string;
        mediaType: string;
        providerOptions: { openai: { imageDetail: "low" } };
      }
  > = [
    {
      type: "text",
      text: `Rendered page visuals for request${attachedPages.length === 1 ? "" : "s"} ${attachedPages.map((pageVisual, index) => `#${index + 1} (page ${pageVisual.pageNumber})`).join(", ")}. Requests may be full pages or cropped page-space regions. Use these visuals for inspection of layout, tables, handwriting, diagrams, stamps, or other details that extracted text may miss. Fixed pixel density ${pageVisualLabelDensity(attachedPages)}. ${AI_PAGE_COORDINATE_CONVENTION}`,
    },
  ];

  for (const [index, pageVisual] of attachedPages.entries()) {
    const cropLabel = pageVisual.cropRect
      ? ` Cropped region x=${pageVisual.cropRect.x}, y=${pageVisual.cropRect.y}, width=${pageVisual.cropRect.width}, height=${pageVisual.cropRect.height}.`
      : " Full page render.";
    content.push({
      type: "text",
      text: `Request #${index + 1}: page ${pageVisual.pageNumber} visual. Actual page size ${pageVisual.pageWidth}x${pageVisual.pageHeight}.${cropLabel} Rendered at ${pageVisual.renderedWidth}x${pageVisual.renderedHeight} using fixed pixel density ${pageVisual.pixelDensity} px per page-space unit.`,
    });
    content.push({
      type: "image-data",
      data: pageVisual.base64Data,
      mediaType: pageVisual.mimeType,
      providerOptions: {
        openai: {
          imageDetail: "low",
        },
      },
    });
  }

  return {
    type: "content" as const,
    value: content,
  };
};

const METADATA_TOOL_PROMPTS = [
  "If the user asks about document metadata, call get_document_metadata.",
];

const MULTI_PAGE_SUMMARY_FALLBACK_PROMPT =
  "If the user asks for a whole-document or many-page summary and no digest tool is available, rely on get_document_context plus targeted page reads.";

const DOCUMENT_CONTEXT_TOOL_PROMPTS = [
  "get_document_context includes per-page type breakdowns for form fields and supported annotations on pages that actually contain them, which is useful before form filling or annotation inspection.",
  "get_document_context also includes the current viewport context: all visible pages intersecting the workspace viewport, page-space viewport rects for those visible pages, current zoom scale and percent, page layout mode, and page flow direction.",
];

const PAGE_VISUAL_TOOL_PROMPTS = [
  "If the task depends on full-page visual appearance, call get_pages_visual before making visual claims.",
  "get_pages_visual renders the current edited document state, not just the originally opened PDF bytes.",
  "Each get_pages_visual pages item may be a page number for a full-page image or an object like { page, rect } to render only a page-space region.",
  `get_pages_visual uses a fixed pixel density of ${AI_CHAT_PAGE_IMAGE_PIXEL_DENSITY} px per page-space unit. Do not try to choose image size manually.`,
  AI_PAGE_COORDINATE_CONVENTION,
  "Use get_pages_visual for scanned pages, handwriting, signatures, stamps, tables, diagrams, charts, or complex layout that plain text extraction may miss.",
  "If get_pages_text or search_document returns empty text, OCR noise, or misses the needed content on a page, do not stop there. Call get_pages_visual for that page and inspect it visually.",
  "When the user asks about a page and the text layer is missing or unreliable, use get_pages_visual before concluding that the page content is unavailable.",
  "If you need several page visuals, prefer one get_pages_visual call with multiple pages over many tiny calls when possible.",
];

const PAGE_VISUAL_SUMMARY_TOOL_PROMPTS = [
  "Use summarize_pages_visual when page appearance matters but the current chat model cannot inspect images directly.",
  "summarize_pages_visual inspects the current edited document state, not just the originally opened PDF bytes.",
  "summarize_pages_visual accepts the same pages format as get_pages_visual, including { page, rect } cropped region requests.",
  `summarize_pages_visual uses the same fixed pixel density as get_pages_visual: ${AI_CHAT_PAGE_IMAGE_PIXEL_DENSITY} px per page-space unit.`,
  AI_PAGE_COORDINATE_CONVENTION,
  "summarize_pages_visual renders requested page visuals and delegates the visual inspection to a configured vision model, then returns a plain-text summary you can reason over.",
  "Pass summary_instructions when the user cares about specific visual details such as tables, handwriting, stamps, diagrams, signatures, highlights, or layout defects.",
  "summary_instructions is a structured object with known_information, remaining_uncertainties, and what_to_add_or_verify.",
];

const GET_PAGES_TEXT_TOOL_PROMPTS = [
  "get_pages_text preserves inferred spaces and line breaks from the PDF while remaining compatible with anchor highlighting.",
  "get_pages_text may truncate at the user-configured text budget. If the result is truncated, call it again with fewer or narrower page_numbers before making claims about omitted content.",
  "For tables, forms, multi-column pages, or irregular layout, call get_pages_text with include_layout true before creating document anchors.",
  "When get_pages_text returns line data, prefer anchors that stay within one line or two adjacent lines instead of stitching distant layout regions together.",
  "If get_pages_text returns no useful text for a page and get_pages_visual is available, follow up with get_pages_visual instead of assuming the page has no usable content.",
];

const SEARCH_DOCUMENT_TOOL_PROMPTS = [
  "search_document only works on documents or pages that have a usable text layer. It is ineffective for image-only scans unless OCR text is already present.",
  "When plain search may fail because of whitespace, punctuation, line breaks, or OCR noise, retry regex such as word1\\s*word2.",
  "search_document result_ids only refer to the exact matchText of each hit. snippet is surrounding context only.",
  "If you need multiple independent search_document calls for different keywords or ranges, issue them in the same step so they can run in parallel.",
  "When presenting search hits to the user, prefer natural clickable result links so the user can click into the exact match.",
];

const LIST_ANNOTATIONS_TOOL_PROMPTS = [
  "If the user asks about comments, notes, highlights, links, or annotations, call list_annotations.",
  "When list_annotations returns highlight annotations, check highlightedText to inspect the actual quoted source text when available.",
  "When list_annotations returns link annotations, inspect linkUrl and linkDestPageNumber to understand the hyperlink target.",
  "When list_annotations returns stamp annotations, inspect stampKind, stampPresetId, stampLabel, and stampHasImage first; if you need the actual stamp graphic content, follow up with get_pages_visual or summarize_pages_visual.",
  "If the user wants to delete one or more specific annotations and ids are not already known, call list_annotations first so you can pass the exact annotation ids to delete_annotations.",
  "When pointing the user to a known annotation, prefer a natural clickable control link instead of plain id text.",
];

const LIST_FIELDS_TOOL_PROMPTS = [
  "If the user asks to fill or update form fields and ids, options, or field mapping are unclear, call list_fields first.",
  "If the user asks where a field is, wants to inspect field geometry, or needs a visually targetable field list, call list_fields with include_layout: true.",
  "If form-filling instructions may be encoded in comments, highlights, or notes, call list_annotations together with list_fields before filling.",
  "When answering where a field is, pair the field id with a natural clickable control link and, if layout is available, add a short page-area description.",
];

const pageVisualLabelDensity = (pages: AiRenderedPageImage[]) => {
  const unique = Array.from(new Set(pages.map((page) => page.pixelDensity)));
  return unique.length === 1
    ? `${unique[0]} px per page-space unit`
    : `${unique.join(", ")} px per page-space unit`;
};

const formatCharCount = (value: number) => `${value.toLocaleString()} chars`;

export const documentToolModule = defineToolModule((ctx) => {
  const getDocumentDigest = ctx.getDocumentDigest;
  const summarizePagesVisual = ctx.summarizePagesVisual;

  return {
    get_document_context: createToolBuilder("get_document_context")
      .read()
      .description(
        "Get lightweight runtime context for the currently opened PDF document, including all pages currently visible in the workspace viewport, page-space viewport rects for visible pages, current zoom scale and percent, page layout mode, page flow direction, and per-page form-field and annotation type breakdowns only for pages that actually contain them.",
      )
      .promptInstructions([
        ...DOCUMENT_CONTEXT_TOOL_PROMPTS,
        ...(ctx.getDocumentDigest ? [] : [MULTI_PAGE_SUMMARY_FALLBACK_PROMPT]),
      ])
      .inputSchema(emptyObjectSchema)
      .build(async ({ ctx: toolCtx }) => {
        const payload = {
          ...toolCtx.getDocumentContext(),
          ...toolCtx.getDocumentPageAssetSummary(),
        };
        return {
          payload,
          summary: `Context for ${payload.pageCount} pages`,
        };
      }),

    get_document_metadata: createToolBuilder("get_document_metadata")
      .read()
      .description(
        "Get PDF document metadata such as filename, title, author, subject, keywords, creator, producer, and creation/modification dates.",
      )
      .promptInstructions(METADATA_TOOL_PROMPTS)
      .inputSchema(emptyObjectSchema)
      .build(async ({ ctx: toolCtx }) => {
        const payload = toolCtx.getDocumentMetadata();
        const availableKeys = Object.entries(payload).filter(([, value]) => {
          if (Array.isArray(value)) return value.length > 0;
          return value !== undefined && value !== null && value !== "";
        }).length;
        return {
          payload,
          summary: `Metadata with ${availableKeys} populated field${availableKeys === 1 ? "" : "s"}`,
        };
      }),

    get_pages_visual: createToolBuilder("get_pages_visual")
      .read()
      .requiresInputModalities(["image"])
      .description(
        `Render one or more PDF page visuals from the current edited document state for multimodal inspection. Each pages item may request a full page or a cropped page-space region. The JSON payload stays lightweight for the chat UI, while the actual rendered visuals are attached to the model context for visual reasoning. Returns at most ${AI_CHAT_MAX_PAGE_IMAGES_PER_CALL} visuals per call.`,
      )
      .promptInstructions(PAGE_VISUAL_TOOL_PROMPTS)
      .inputSchema(getPagesVisualArgsSchema)
      .toModelOutput(({ output }) => toPagesVisualModelOutput(output))
      .build(async ({ args, ctx: toolCtx, signal }) => {
        const documentContext = toolCtx.getDocumentContext();
        const pageRequests: PageVisualRequestArg[] =
          args.pages.length > 0
            ? (args.pages as PageVisualRequestArg[])
            : [
                documentContext.currentPageNumber ??
                  documentContext.visiblePageNumbers[0],
              ].filter(
                (pageNumber): pageNumber is number =>
                  typeof pageNumber === "number",
              );

        if (pageRequests.length === 0) {
          return {
            payload: createErrorPayload(
              "NO_PAGE_AVAILABLE",
              "get_pages_visual requires at least one valid page request or an active page in the current document.",
            ),
            summary: "get_pages_visual failed: no page available",
          };
        }

        const pageVisualBatch = await toolCtx.getPagesVisual({
          pageNumbers: pageRequests,
          renderAnnotations: args.render_annotations,
          signal,
        });

        return {
          payload: {
            requestedPageCount: pageVisualBatch.requestedPageCount,
            returnedPageCount: pageVisualBatch.returnedPageCount,
            truncated: pageVisualBatch.truncated,
            maxPagesPerCall: pageVisualBatch.maxPagesPerCall,
            pages: pageVisualBatch.pages.map((pageVisual) => ({
              pageNumber: pageVisual.pageNumber,
              pageWidth: pageVisual.pageWidth,
              pageHeight: pageVisual.pageHeight,
              rotation: pageVisual.rotation,
              cropRect: pageVisual.cropRect,
              pixelDensity: pageVisual.pixelDensity,
              renderedWidth: pageVisual.renderedWidth,
              renderedHeight: pageVisual.renderedHeight,
              mimeType: pageVisual.mimeType,
              renderAnnotations: pageVisual.renderAnnotations,
              imageAttachedForModel: true,
              modelAttachmentMode: "multimodal_tool_result",
            })),
          },
          modelOutput: pageVisualBatch,
          summary: pageVisualBatch.truncated
            ? `Rendered ${pageVisualBatch.returnedPageCount} of ${pageVisualBatch.requestedPageCount} requested page visuals (limit ${pageVisualBatch.maxPagesPerCall})`
            : `Rendered ${pageVisualBatch.returnedPageCount} page visual${pageVisualBatch.returnedPageCount === 1 ? "" : "s"}`,
        };
      }),

    summarize_pages_visual: createToolBuilder("summarize_pages_visual")
      .enable(Boolean(summarizePagesVisual))
      .read()
      .description(
        `Render one or more PDF page visuals from the current edited document state and return a plain-text visual summary produced by a configured vision model. Each pages item may request a full page or a cropped page-space region. Use this when page appearance matters but the current chat model cannot inspect images directly. Returns at most ${AI_CHAT_MAX_PAGE_IMAGES_PER_CALL} visuals per call.`,
      )
      .promptInstructions(PAGE_VISUAL_SUMMARY_TOOL_PROMPTS)
      .inputSchema(summarizePagesVisualArgsSchema)
      .build(async ({ args, ctx: toolCtx, signal }) => {
        const documentContext = toolCtx.getDocumentContext();
        const pageRequests: PageVisualRequestArg[] =
          args.pages.length > 0
            ? (args.pages as PageVisualRequestArg[])
            : [
                documentContext.currentPageNumber ??
                  documentContext.visiblePageNumbers[0],
              ].filter(
                (pageNumber): pageNumber is number =>
                  typeof pageNumber === "number",
              );

        if (pageRequests.length === 0) {
          return {
            payload: createErrorPayload(
              "NO_PAGE_AVAILABLE",
              "summarize_pages_visual requires at least one valid page request or an active page in the current document.",
            ),
            summary: "summarize_pages_visual failed: no page available",
          };
        }

        const visualSummary = await summarizePagesVisual!({
          pageNumbers: pageRequests,
          renderAnnotations: args.render_annotations,
          summaryInstructions: args.summary_instructions,
          signal,
        });

        const payload: AiRenderedPageVisualSummaryResult = {
          requestedPageCount: visualSummary.requestedPageCount,
          returnedPageCount: visualSummary.returnedPageCount,
          truncated: visualSummary.truncated,
          maxPagesPerCall: visualSummary.maxPagesPerCall,
          pages: visualSummary.pages,
          summary: visualSummary.summary,
        };

        return {
          payload,
          modelOutput: payload.summary,
          summary: payload.truncated
            ? `Summarized ${payload.returnedPageCount} of ${payload.requestedPageCount} requested rendered pages`
            : `Summarized rendered page${payload.returnedPageCount === 1 ? "" : "s"} for ${payload.returnedPageCount} page${payload.returnedPageCount === 1 ? "" : "s"}`,
        };
      }),

    get_document_digest: createToolBuilder("get_document_digest")
      .enable(Boolean(getDocumentDigest))
      .read()
      .description(
        "Get an AI digest for exactly one contiguous page range. start_page and end_page are required. This tool can summarize very large ranges, including a whole document, because it automatically chunks and merges long ranges internally. The payload includes overall_excerpt for the full requested range plus per-chunk excerpts for supporting detail. Optionally pass summary_instructions as a structured object to guide the digest summarizer.",
      )
      .promptInstructions([
        "If the user asks for a whole-document or many-page summary, call get_document_context first and then call get_document_digest once for the full needed page range before any targeted page reads. get_document_digest already handles internal chunking for long ranges.",
        "summary_instructions is a structured object with known_information, remaining_uncertainties, and what_to_add_or_verify.",
      ])
      .inputSchema(getDocumentDigestArgsSchema)
      .build(async ({ args, signal, onProgress }) => {
        const digest = await getDocumentDigest!({
          startPage: args.start_page,
          endPage: args.end_page,
          charsPerChunk: args.chars_per_chunk,
          sourceCharsPerChunk: args.source_chars_per_chunk,
          summaryInstructions: args.summary_instructions,
          signal,
          onProgress,
        });

        return {
          payload: digest,
          summary: `AI digest covers ${digest.returnedPageCount} page${digest.returnedPageCount === 1 ? "" : "s"} with ${digest.chunkCount} leaf chunk${digest.chunkCount === 1 ? "" : "s"}`,
        };
      }),

    get_pages_text: createToolBuilder("get_pages_text")
      .read()
      .description(
        "Read full text for one or more pages. Returned text preserves inferred spaces and line breaks from PDF layout while staying compatible with anchor highlighting. Optionally include per-line layout rectangles. The per-call text budget is configured in AI chat settings.",
      )
      .promptInstructions(GET_PAGES_TEXT_TOOL_PROMPTS)
      .inputSchema(getPagesTextArgsSchema)
      .build(async ({ args, ctx: toolCtx, signal }) => {
        const result = await toolCtx.getPagesText({
          pageNumbers: args.page_numbers,
          includeLayout: args.include_layout,
          signal,
        });

        return {
          payload: result,
          summary: result.truncated
            ? `Read ${formatCharCount(result.returnedCharCount)} from ${result.returnedPageCount} of ${result.requestedPageCount} requested page${result.requestedPageCount === 1 ? "" : "s"} (truncated at ${formatCharCount(result.maxCharsPerCall)})`
            : `Read ${formatCharCount(result.returnedCharCount)} from ${result.returnedPageCount} page${result.returnedPageCount === 1 ? "" : "s"}`,
        };
      }),

    search_document: createToolBuilder("search_document")
      .read()
      .description(
        "Search the current document and return result ids that can be focused or highlighted later. This only works when the PDF pages have a usable text layer, so it is not effective for image-only scans unless OCR text is already present. result_id highlights only the exact matchText for that search hit; snippet is context only and cannot be highlighted directly. For longer phrases, sentences, or ranges, use selection_anchors or document_anchors with highlight_results. Supports plain substring search and regex search for flexible whitespace or token patterns.",
      )
      .promptInstructions(SEARCH_DOCUMENT_TOOL_PROMPTS)
      .inputSchema(searchDocumentArgsSchema)
      .build(async ({ args, ctx: toolCtx, signal }) => {
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

        const results = await toolCtx.searchDocument({
          query,
          mode: args.mode,
          regexFlags: args.regex_flags?.trim() || undefined,
          pageNumbers: args.page_numbers,
          caseSensitive: args.case_sensitive,
          maxResults: args.max_results,
          signal,
        });
        const remembered = toolCtx.rememberSearchResults(query, results);

        return {
          payload: {
            query,
            total: remembered.length,
            results: remembered,
          },
          summary: summarizeSearchResults(remembered),
        };
      }),

    list_annotations: createToolBuilder("list_annotations")
      .read()
      .description(
        "List existing annotations in the current document, including comments, highlights, free text, ink, shape, stamp, and hyperlink annotations. Shape annotations include subType. Highlight annotations include note/comment text plus highlightedText when the source text is known. Stamp annotations include stampKind, stampPresetId, stampLabel, and stampHasImage. Link annotations include linkUrl and linkDestPageNumber when available.",
      )
      .promptInstructions(LIST_ANNOTATIONS_TOOL_PROMPTS)
      .inputSchema(listAnnotationsArgsSchema)
      .build(async ({ args, ctx: toolCtx }) => {
        const result = toolCtx.listAnnotations({
          query: args.query?.trim() || undefined,
          pageNumbers: args.page_numbers,
          types: args.types,
          maxResults: args.max_results,
        });

        return {
          payload: result,
          summary: summarizeListedAnnotations(result.total, result.returned),
        };
      }),

    list_fields: createToolBuilder("list_fields")
      .read()
      .description(
        "List existing PDF form fields that the AI can inspect before filling. Returns field ids, types, page numbers, current values, and available options. Optionally include field rectangles for visual targeting. Use together with list_annotations when comments or highlights describe how fields should be filled.",
      )
      .promptInstructions(LIST_FIELDS_TOOL_PROMPTS)
      .inputSchema(listFormFieldsArgsSchema)
      .build(async ({ args, ctx: toolCtx }) => {
        const result = toolCtx.listFormFields({
          pageNumbers: args.page_numbers,
          query: args.query?.trim() || undefined,
          onlyEmpty: args.only_empty,
          includeReadOnly: args.include_read_only,
          includeLayout: args.include_layout,
          maxResults: args.max_results,
        });

        return {
          payload: result,
          summary: summarizeListedFormFields(result.total, result.returned),
        };
      }),
  };
});
