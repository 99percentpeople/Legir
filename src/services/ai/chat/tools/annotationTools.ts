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
  updateAnnotationTextsArgsSchema,
  type AiToolHandlerMap,
} from "./shared";

export const createAnnotationToolHandlers = (
  ctx: AiToolExecutionContext,
): AiToolHandlerMap<
  | "list_annotations"
  | "update_annotation_texts"
  | "highlight_results"
  | "clear_highlights"
> => ({
  list_annotations: {
    definition: defineTool("read", {
      name: "list_annotations",
      description:
        "List existing annotations in the current document, including comments and highlights. Highlight annotations include note/comment text plus highlightedText when the source text is known.",
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

  update_annotation_texts: {
    definition: defineTool("write", {
      name: "update_annotation_texts",
      description:
        "Update note/comment text on one or more annotations by id. Accepts either a single annotation_id plus text or an updates array. Use list_annotations first when you need ids or want to inspect the current note/highlight text before editing.",
      inputSchema: updateAnnotationTextsArgsSchema,
    }),
    execute: async (rawArgs) => {
      const parsed = parseToolArgs(updateAnnotationTextsArgsSchema, rawArgs);
      if (parsed.success === false) {
        return createInvalidArgumentsResult(
          "update_annotation_texts",
          parsed.error,
        );
      }

      const result = ctx.updateAnnotationTexts({
        updates: parsed.data.updates.map((item) => ({
          annotationId: item.annotation_id.trim(),
          text: item.text,
        })),
      });

      return {
        payload: result,
        summary:
          result.updatedCount > 0
            ? result.rejectedCount > 0 || result.unchangedCount > 0
              ? `Updated ${result.updatedCount} annotation text entr${result.updatedCount === 1 ? "y" : "ies"}, ${result.unchangedCount} unchanged, ${result.rejectedCount} rejected`
              : `Updated ${result.updatedCount} annotation text entr${result.updatedCount === 1 ? "y" : "ies"}`
            : "update_annotation_texts completed with no changes",
      };
    },
  },

  highlight_results: {
    definition: defineTool("write", {
      name: "highlight_results",
      description:
        "Create one or more highlight annotations from result_ids, selection_anchors, or document_anchors in a single batch. Accepts singular or plural target fields. result_ids highlight only exact matchText values, never the surrounding snippets.",
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
