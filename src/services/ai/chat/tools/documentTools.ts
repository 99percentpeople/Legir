import { AI_CHAT_MAX_READ_PAGES_PER_CALL } from "@/constants";

import {
  createErrorPayload,
  createToolBuilder,
  defineToolModule,
  emptyObjectSchema,
  getDocumentDigestArgsSchema,
  readPagesArgsSchema,
  searchDocumentArgsSchema,
  summarizeSearchResults,
} from "./shared";

const METADATA_TOOL_PROMPTS = [
  "If the user asks about document metadata, call get_document_metadata.",
];

const MULTI_PAGE_SUMMARY_FALLBACK_PROMPT =
  "If the user asks for a whole-document or many-page summary and no digest tool is available, rely on get_document_context plus targeted page reads.";

const READ_PAGES_TOOL_PROMPTS = [
  "read_pages text preserves inferred spaces and line breaks from the PDF while remaining compatible with anchor highlighting.",
  "If one read_pages call can cover all needed pages, prefer that over many tiny page reads.",
  "If you need multiple independent read-only tools such as get_document_context, get_document_metadata, read_pages, search_document, or get_document_digest, you may call those read tools in parallel in the same step.",
  "For tables, forms, multi-column pages, or irregular layout, call read_pages with include_layout true before creating document anchors.",
  "When read_pages returns line data, prefer anchors that stay within one line or two adjacent lines instead of stitching distant layout regions together.",
];

const SEARCH_DOCUMENT_TOOL_PROMPTS = [
  "When plain search may fail because of whitespace, punctuation, line breaks, or OCR noise, retry regex such as word1\\s*word2.",
  "search_document result_ids only refer to the exact matchText of each hit. snippet is surrounding context only.",
];

export const documentToolModule = defineToolModule((ctx) => {
  const getDocumentDigest = ctx.getDocumentDigest;

  return {
    get_document_context: createToolBuilder("get_document_context")
      .read()
      .description(
        "Get lightweight runtime context for the currently opened PDF document.",
      )
      .promptInstructions(
        ctx.getDocumentDigest ? [] : [MULTI_PAGE_SUMMARY_FALLBACK_PROMPT],
      )
      .inputSchema(emptyObjectSchema)
      .build(async ({ ctx: toolCtx }) => {
        const payload = toolCtx.getDocumentContext();
        return {
          payload,
          summary: `Context for ${payload.filename}, ${payload.pageCount} pages`,
        };
      }),

    get_document_metadata: createToolBuilder("get_document_metadata")
      .read()
      .description(
        "Get PDF document metadata such as title, author, subject, keywords, creator, producer, and creation/modification dates.",
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

    read_pages: createToolBuilder("read_pages")
      .read()
      .description(
        `Read full text for one or more pages. Returned text preserves inferred spaces and line breaks from PDF layout while staying compatible with anchor highlighting. Optionally include per-line layout rectangles. Returns at most ${AI_CHAT_MAX_READ_PAGES_PER_CALL} pages per call.`,
      )
      .promptInstructions(READ_PAGES_TOOL_PROMPTS)
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
  };
});
