import { AI_CHAT_MAX_READ_PAGES_PER_CALL } from "@/constants";
import type { AiToolExecutionContext } from "@/services/ai/chat/types";

import {
  createErrorPayload,
  createInvalidArgumentsResult,
  defineTool,
  emptyObjectSchema,
  getDocumentDigestArgsSchema,
  parseToolArgs,
  readPagesArgsSchema,
  searchDocumentArgsSchema,
  summarizeSearchResults,
  type AiToolHandlerMap,
} from "./shared";

export const createDocumentToolHandlers = (
  ctx: AiToolExecutionContext,
): AiToolHandlerMap<
  | "get_document_context"
  | "get_document_metadata"
  | "get_document_digest"
  | "read_pages"
  | "search_document"
> => ({
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

  ...(ctx.documentContextService.getDocumentDigest
    ? {
        get_document_digest: {
          definition: defineTool("read", {
            name: "get_document_digest",
            description:
              "Get an AI digest for exactly one contiguous page range. start_page and end_page are required. This tool can summarize very large ranges, including a whole document, because it automatically chunks and merges long ranges internally. The payload includes overall_excerpt for the full requested range plus per-chunk excerpts for supporting detail. Optionally pass summary_instructions to tell the digest summarizer what to focus on.",
            inputSchema: getDocumentDigestArgsSchema,
          }),
          execute: async (rawArgs, _ctx, signal, onProgress) => {
            const parsed = parseToolArgs(getDocumentDigestArgsSchema, rawArgs);
            if (parsed.success === false) {
              return createInvalidArgumentsResult(
                "get_document_digest",
                parsed.error,
              );
            }

            const args = parsed.data;
            const digest = await ctx.documentContextService.getDocumentDigest!({
              startPage: args.start_page,
              endPage: args.end_page,
              charsPerChunk: args.chars_per_chunk,
              sourceCharsPerChunk: args.source_chars_per_chunk,
              summaryInstructions:
                args.summary_instructions?.trim() || undefined,
              signal,
              onProgress,
            });

            return {
              payload: digest,
              summary: `AI digest covers ${digest.returnedPageCount} page${digest.returnedPageCount === 1 ? "" : "s"} with ${digest.chunkCount} leaf chunk${digest.chunkCount === 1 ? "" : "s"}`,
            };
          },
        },
      }
    : {}),

  read_pages: {
    definition: defineTool("read", {
      name: "read_pages",
      description: `Read full text for one or more pages. Optionally include per-line layout rectangles. Returns at most ${AI_CHAT_MAX_READ_PAGES_PER_CALL} pages per call.`,
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
        "Search the current document and return result ids that can be focused or highlighted later. result_id highlights only the exact matchText for that search hit; snippet is context only and cannot be highlighted directly. For longer phrases, sentences, or ranges, use selection_anchors or document_anchors with highlight_results. Supports plain substring search and regex search for flexible whitespace or token patterns.",
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
});
