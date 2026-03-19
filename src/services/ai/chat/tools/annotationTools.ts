import {
  createErrorPayload,
  createToolBuilder,
  deleteHighlightsArgsSchema,
  defineToolModule,
  emptyObjectSchema,
  highlightResultsArgsSchema,
  updateAnnotationTextsArgsSchema,
} from "./shared";

const UPDATE_ANNOTATION_TEXTS_TOOL_PROMPTS = [
  "If the user asks to rename, rewrite, clear, or update annotation/comment text, call update_annotation_texts. It accepts either one annotation_id plus text or an updates array.",
];

const HIGHLIGHT_RESULTS_TOOL_PROMPTS = [
  "Selection attachment blocks include raw text plus attachment_index, page_number, and absolute offsets.",
  "If the target is inside the latest selection attachment, prefer selection_anchors. If the target text is already known from the user's message or from pages you already read, prefer document_anchors. Use result_ids for exact search hits. Include page_hint for document_anchors when the likely page is known.",
  "Do not use result_id when the user wants a whole sentence, paragraph, or range that is longer than matchText. In that case use selection_anchors or document_anchors with highlight_results.",
  "Use highlight_results for both single-target and multi-target highlight creation. It accepts singular or plural target fields.",
  "Pass annotation_text when the highlight note should differ from the source text. Use top-level annotation_text only when every created highlight should share the same note. Otherwise set annotation_text on each selection_anchor or document_anchor item.",
  "end_inclusive_anchor is inclusive: the created highlight must include that text.",
  "Choose short, exact anchors from visible text. Do not infer sentence structure inside a selection attachment. Whitespace is flexible during matching. Prefer 2 to 8 words, extend only when needed for uniqueness, and shorten aggressively if a long anchor fails.",
  "If highlight_results returns missing_count > 0, retry only the missing anchors with shorter, more distinctive text.",
];

const DELETE_HIGHLIGHTS_TOOL_PROMPTS = [
  "If the user wants to delete specific highlights and exact annotation ids are not already known, call list_annotations first to identify the target highlight annotation ids.",
  "Use delete_highlights for both single-target and multi-target highlight deletion. Always pass annotation_ids, using either one id string or an array of id strings in that same field.",
  "delete_highlights only removes highlight annotations. Do not use it for comments, ink, free text, or link annotations.",
  "Use clear_highlights only when the user wants to clear all AI-created highlights at once.",
];

export const annotationToolModule = defineToolModule((_ctx) => ({
  update_annotation_texts: createToolBuilder("update_annotation_texts")
    .write()
    .description(
      "Update note/comment text on one or more annotations by id. Accepts either a single annotation_id plus text or an updates array. Use list_annotations first when you need ids or want to inspect the current note/highlight text before editing.",
    )
    .promptInstructions(UPDATE_ANNOTATION_TEXTS_TOOL_PROMPTS)
    .inputSchema(updateAnnotationTextsArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const result = toolCtx.updateAnnotationTexts({
        updates: args.updates.map((item) => ({
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
    }),

  highlight_results: createToolBuilder("highlight_results")
    .write()
    .description(
      "Create one or more highlight annotations from result_ids, selection_anchors, or document_anchors in a single batch. Accepts singular or plural target fields. result_ids highlight only exact matchText values, never the surrounding snippets.",
    )
    .promptInstructions(HIGHLIGHT_RESULTS_TOOL_PROMPTS)
    .inputSchema(highlightResultsArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const resultIds = args.result_ids.map((id) => id.trim());
      const annotationText = args.annotation_text?.trim() || undefined;
      const selectionAnchors = args.selection_anchors.map((range) => ({
        attachmentIndex: range.attachment_index,
        startAnchor: range.start_anchor.trim(),
        endInclusiveAnchor: range.end_inclusive_anchor.trim(),
        annotationText: range.annotation_text?.trim() || undefined,
      }));
      const documentAnchors = args.document_anchors.map((range) => ({
        startAnchor: range.start_anchor.trim(),
        endInclusiveAnchor: range.end_inclusive_anchor.trim(),
        pageHint: range.page_hint,
        annotationText: range.annotation_text?.trim() || undefined,
      }));

      const hasAnyValidId = resultIds.some((id) =>
        toolCtx.getStoredSearchResult(id),
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

      const result = await toolCtx.createSearchHighlightAnnotations({
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
    }),

  delete_highlights: createToolBuilder("delete_highlights")
    .write()
    .description(
      "Delete one or more existing highlight annotations by id. Always use annotation_ids; it may be either a single id string or an array of id strings. Use list_annotations first when you need to locate the target highlight ids.",
    )
    .promptInstructions(DELETE_HIGHLIGHTS_TOOL_PROMPTS)
    .inputSchema(deleteHighlightsArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const result = toolCtx.deleteHighlightAnnotations({
        annotationIds: args.annotation_ids.map((annotationId) =>
          annotationId.trim(),
        ),
      });

      return {
        payload: result,
        summary:
          result.deletedCount > 0
            ? result.rejectedCount > 0
              ? `Deleted ${result.deletedCount} highlight annotation${result.deletedCount === 1 ? "" : "s"}, ${result.rejectedCount} rejected`
              : `Deleted ${result.deletedCount} highlight annotation${result.deletedCount === 1 ? "" : "s"}`
            : "delete_highlights completed with no deletions",
      };
    }),

  clear_highlights: createToolBuilder("clear_highlights")
    .write()
    .description(
      "Remove AI-created search highlight annotations from the workspace.",
    )
    .inputSchema(emptyObjectSchema)
    .build(async ({ ctx: toolCtx }) => {
      const result = toolCtx.clearSearchHighlights();
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
    }),
}));
