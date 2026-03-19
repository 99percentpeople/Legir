import { z } from "zod";
import {
  AI_CHAT_MAX_PAGE_IMAGES_PER_CALL,
  AI_CHAT_MAX_READ_PAGES_PER_CALL,
} from "@/constants";

import {
  createErrorPayload,
  createToolBuilder,
  defineToolModule,
  emptyObjectSchema,
  getDocumentDigestArgsSchema,
  pageNumberSchema,
  pageNumbersSchema,
  listAnnotationsArgsSchema,
  listFormFieldsArgsSchema,
  readPagesArgsSchema,
  searchDocumentArgsSchema,
  summarizeListedAnnotations,
  summarizeListedFormFields,
  summarizeSearchResults,
} from "./shared";
import type {
  AiRenderedPageImage,
  AiRenderedPageImageBatch,
} from "@/services/ai/chat/types";

const DEFAULT_PAGE_IMAGE_TARGET_WIDTH = 1024;
const getPagesImageArgsSchema = z
  .object({
    page_numbers: pageNumbersSchema
      .optional()
      .default([])
      .describe(
        "Optional 1-based page numbers to render. Defaults to the current page when omitted.",
      ),
    target_width: pageNumberSchema
      .optional()
      .default(DEFAULT_PAGE_IMAGE_TARGET_WIDTH)
      .describe(
        "Optional target raster width in pixels for the full-page image. Higher values preserve more detail but use more vision tokens.",
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

const toPagesImageModelOutput = (output: unknown) => {
  if (!output || typeof output !== "object") {
    return {
      type: "text" as const,
      value: "Page images unavailable.",
    };
  }

  const batch = output as AiRenderedPageImageBatch;
  if (!Array.isArray(batch.pages) || batch.pages.length === 0) {
    return {
      type: "text" as const,
      value: "Page images unavailable.",
    };
  }

  const attachedPages = batch.pages.filter(
    (pageImage): pageImage is AiRenderedPageImage =>
      typeof pageImage.base64Data === "string" &&
      !!pageImage.base64Data &&
      typeof pageImage.mimeType === "string" &&
      !!pageImage.mimeType,
  );

  if (attachedPages.length === 0) {
    return {
      type: "text" as const,
      value: "Page images unavailable.",
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
      text: `Full-page images for page${attachedPages.length === 1 ? "" : "s"} ${attachedPages.map((pageImage) => pageImage.pageNumber).join(", ")}. Use these images for visual inspection of layout, tables, handwriting, diagrams, stamps, or other details that extracted text may miss.`,
    },
  ];

  for (const pageImage of attachedPages) {
    content.push({
      type: "text",
      text: `Page ${pageImage.pageNumber} image. Rendered at ${pageImage.renderedWidth}x${pageImage.renderedHeight}.`,
    });
    content.push({
      type: "image-data",
      data: pageImage.base64Data,
      mediaType: pageImage.mimeType,
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
  "get_document_context also includes the current viewport context: all visible pages intersecting the workspace viewport, current zoom scale and percent, page layout mode, and page flow direction.",
];

const PAGE_IMAGE_TOOL_PROMPTS = [
  "If the task depends on full-page visual appearance, call get_pages_image before making visual claims.",
  "Use get_pages_image for scanned pages, handwriting, signatures, stamps, tables, diagrams, charts, or complex layout that plain text extraction may miss.",
  "If get_pages_text or search_document returns empty text, OCR noise, or misses the needed content on a page, do not stop there. Call get_pages_image for that page and inspect it visually.",
  "When the user asks about a page and the text layer is missing or unreliable, use get_pages_image before concluding that the page content is unavailable.",
  "If you need several page images, prefer one get_pages_image call with multiple page_numbers over many tiny calls when possible.",
];

const GET_PAGES_TEXT_TOOL_PROMPTS = [
  "get_pages_text preserves inferred spaces and line breaks from the PDF while remaining compatible with anchor highlighting.",
  "For tables, forms, multi-column pages, or irregular layout, call get_pages_text with include_layout true before creating document anchors.",
  "When get_pages_text returns line data, prefer anchors that stay within one line or two adjacent lines instead of stitching distant layout regions together.",
  "If get_pages_text returns no useful text for a page and get_pages_image is available, follow up with get_pages_image instead of assuming the page has no usable content.",
];

const SEARCH_DOCUMENT_TOOL_PROMPTS = [
  "When plain search may fail because of whitespace, punctuation, line breaks, or OCR noise, retry regex such as word1\\s*word2.",
  "search_document result_ids only refer to the exact matchText of each hit. snippet is surrounding context only.",
  "If you need multiple independent search_document calls for different keywords or ranges, issue them in the same step so they can run in parallel.",
  "When presenting search hits to the user, prefer natural clickable result links so the user can click into the exact match.",
];

const LIST_ANNOTATIONS_TOOL_PROMPTS = [
  "If the user asks about comments, notes, highlights, links, or annotations, call list_annotations.",
  "When list_annotations returns highlight annotations, check highlightedText to inspect the actual quoted source text when available.",
  "When list_annotations returns link annotations, inspect linkUrl and linkDestPageNumber to understand the hyperlink target.",
  "When pointing the user to a known annotation, prefer a natural clickable control link instead of plain id text.",
];

const LIST_FIELDS_TOOL_PROMPTS = [
  "If the user asks to fill or update form fields and ids, options, or field mapping are unclear, call list_fields first.",
  "If the user asks where a field is, wants to inspect field geometry, or needs a visually targetable field list, call list_fields with include_layout: true.",
  "If form-filling instructions may be encoded in comments, highlights, or notes, call list_annotations together with list_fields before filling.",
  "When answering where a field is, pair the field id with a natural clickable control link and, if layout is available, add a short page-area description.",
];

export const documentToolModule = defineToolModule((ctx) => {
  const getDocumentDigest = ctx.getDocumentDigest;

  return {
    get_document_context: createToolBuilder("get_document_context")
      .read()
      .description(
        "Get lightweight runtime context for the currently opened PDF document, including all pages currently visible in the workspace viewport, current zoom scale and percent, page layout mode, page flow direction, and per-page form-field and annotation type breakdowns only for pages that actually contain them.",
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

    get_pages_image: createToolBuilder("get_pages_image")
      .read()
      .requiresInputModalities(["image"])
      .description(
        `Render one or more full PDF pages as images for multimodal inspection. The JSON payload stays lightweight for the chat UI, while the actual page images are attached to the model context for visual reasoning. Returns at most ${AI_CHAT_MAX_PAGE_IMAGES_PER_CALL} pages per call.`,
      )
      .promptInstructions(PAGE_IMAGE_TOOL_PROMPTS)
      .inputSchema(getPagesImageArgsSchema)
      .toModelOutput(({ output }) => toPagesImageModelOutput(output))
      .build(async ({ args, ctx: toolCtx, signal }) => {
        const documentContext = toolCtx.getDocumentContext();
        const pageNumbers =
          args.page_numbers.length > 0
            ? args.page_numbers
            : [
                documentContext.currentPageNumber ??
                  documentContext.visiblePageNumbers[0],
              ].filter(
                (pageNumber): pageNumber is number =>
                  typeof pageNumber === "number",
              );

        if (pageNumbers.length === 0) {
          return {
            payload: createErrorPayload(
              "NO_PAGE_AVAILABLE",
              "get_pages_image requires at least one valid page number or an active page in the current document.",
            ),
            summary: "get_pages_image failed: no page available",
          };
        }

        const pageImageBatch = await toolCtx.getPagesImage({
          pageNumbers,
          targetWidth: args.target_width,
          renderAnnotations: args.render_annotations,
          signal,
        });

        return {
          payload: {
            requestedPageCount: pageImageBatch.requestedPageCount,
            returnedPageCount: pageImageBatch.returnedPageCount,
            truncated: pageImageBatch.truncated,
            maxPagesPerCall: pageImageBatch.maxPagesPerCall,
            pages: pageImageBatch.pages.map((pageImage) => ({
              pageNumber: pageImage.pageNumber,
              pageWidth: pageImage.pageWidth,
              pageHeight: pageImage.pageHeight,
              rotation: pageImage.rotation,
              targetWidth: pageImage.targetWidth,
              renderedWidth: pageImage.renderedWidth,
              renderedHeight: pageImage.renderedHeight,
              mimeType: pageImage.mimeType,
              renderAnnotations: pageImage.renderAnnotations,
              imageAttachedForModel: true,
              modelAttachmentMode: "multimodal_tool_result",
            })),
          },
          modelOutput: pageImageBatch,
          summary: pageImageBatch.truncated
            ? `Rendered ${pageImageBatch.returnedPageCount} of ${pageImageBatch.requestedPageCount} requested page images (limit ${pageImageBatch.maxPagesPerCall})`
            : `Rendered full-page image${pageImageBatch.returnedPageCount === 1 ? "" : "s"} for ${pageImageBatch.returnedPageCount} page${pageImageBatch.returnedPageCount === 1 ? "" : "s"}`,
        };
      }),

    get_document_digest: createToolBuilder("get_document_digest")
      .enable(Boolean(getDocumentDigest))
      .read()
      .description(
        "Get an AI digest for exactly one contiguous page range. start_page and end_page are required. This tool can summarize very large ranges, including a whole document, because it automatically chunks and merges long ranges internally. The payload includes overall_excerpt for the full requested range plus per-chunk excerpts for supporting detail. Optionally pass summary_instructions to tell the digest summarizer what to focus on.",
      )
      .promptInstructions([
        "If the user asks for a whole-document or many-page summary, call get_document_context first and then call get_document_digest once for the full needed page range before any targeted page reads. get_document_digest already handles internal chunking for long ranges.",
      ])
      .inputSchema(getDocumentDigestArgsSchema)
      .build(async ({ args, signal, onProgress }) => {
        const digest = await getDocumentDigest!({
          startPage: args.start_page,
          endPage: args.end_page,
          charsPerChunk: args.chars_per_chunk,
          sourceCharsPerChunk: args.source_chars_per_chunk,
          summaryInstructions: args.summary_instructions?.trim() || undefined,
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
        `Read full text for one or more pages. Returned text preserves inferred spaces and line breaks from PDF layout while staying compatible with anchor highlighting. Optionally include per-line layout rectangles. Returns at most ${AI_CHAT_MAX_READ_PAGES_PER_CALL} pages per call.`,
      )
      .promptInstructions(GET_PAGES_TEXT_TOOL_PROMPTS)
      .inputSchema(readPagesArgsSchema)
      .build(async ({ args, ctx: toolCtx, signal }) => {
        const result = await toolCtx.readPages({
          pageNumbers: args.page_numbers,
          includeLayout: args.include_layout,
          signal,
        });

        return {
          payload: result,
          summary: result.truncated
            ? `Read ${result.returnedPageCount} of ${result.requestedPageCount} requested pages (limit ${result.maxPagesPerCall})`
            : `Read ${result.returnedPageCount} page${result.returnedPageCount === 1 ? "" : "s"}`,
        };
      }),

    search_document: createToolBuilder("search_document")
      .read()
      .description(
        "Search the current document and return result ids that can be focused or highlighted later. result_id highlights only the exact matchText for that search hit; snippet is context only and cannot be highlighted directly. For longer phrases, sentences, or ranges, use selection_anchors or document_anchors with highlight_results. Supports plain substring search and regex search for flexible whitespace or token patterns.",
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
        "List existing annotations in the current document, including comments, highlights, free text, ink, and hyperlink annotations. Highlight annotations include note/comment text plus highlightedText when the source text is known. Link annotations include linkUrl and linkDestPageNumber when available.",
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
