import type { AiToolExecutionContext } from "@/services/ai/chat/types";

import {
  createErrorPayload,
  createInvalidArgumentsResult,
  defineTool,
  emptyObjectSchema,
  highlightResultsArgsSchema,
  listAnnotationsArgsSchema,
  parseToolArgs,
  summarizeListedAnnotations,
  type AiToolHandlerMap,
} from "./shared";

export const createAnnotationToolHandlers = (
  ctx: AiToolExecutionContext,
): AiToolHandlerMap<
  "list_annotations" | "highlight_results" | "clear_highlights"
> => ({
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
        return createInvalidArgumentsResult("highlight_results", parsed.error);
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
});
