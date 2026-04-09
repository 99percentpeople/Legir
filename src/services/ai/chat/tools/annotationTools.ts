import {
  createErrorPayload,
  createFreetextAnnotationsArgsSchema,
  createShapeAnnotationsArgsSchema,
  createToolBuilder,
  deleteAnnotationsArgsSchema,
  defineToolModule,
  emptyObjectSchema,
  highlightResultsArgsSchema,
  updateFreetextAnnotationsArgsSchema,
  updateHighlightAnnotationsArgsSchema,
  updateShapeAnnotationsArgsSchema,
  updateAnnotationTextsArgsSchema,
} from "./shared";
import type { AiAnnotationUpdateResult } from "@/services/ai/chat/types";
import { AI_PAGE_COORDINATE_CONVENTION } from "@/services/ai/utils/pageCoordinates";

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

const CREATE_FREETEXT_ANNOTATIONS_TOOL_PROMPTS = [
  "This tool is only available to image-capable chat models.",
  "When the user wants a visible text box, label, note, callout, or overlay placed on the PDF, inspect the relevant page with get_pages_visual first unless the user already provided exact page coordinates.",
  AI_PAGE_COORDINATE_CONVENTION,
  "Keep freetext content concise and place it where it clearly corresponds to the referenced visual region.",
];

const CREATE_SHAPE_ANNOTATIONS_TOOL_PROMPTS = [
  "This tool is only available to image-capable chat models.",
  "When the user wants boxes, circles, arrows, lines, polygons, or other drawn callouts on the PDF, inspect the relevant page with get_pages_visual first unless the user already provided exact page coordinates.",
  "If the created shape should also carry a PDF note/comment, set annotation_text.",
  "Use rect for square, circle, and cloud shapes. Use points for polyline, polygon, cloud_polygon, or when an arrow/line needs custom vertices.",
  AI_PAGE_COORDINATE_CONVENTION,
];

const DELETE_ANNOTATIONS_TOOL_PROMPTS = [
  "If the user wants to delete specific annotations and exact annotation ids are not already known, call list_annotations first to identify the target annotation ids.",
  "Use delete_annotations for both single-target and multi-target annotation deletion. Always pass annotation_ids, using either one id string or an array of id strings in that same field.",
  "Use clear_highlights only when the user wants to clear all AI-created highlights at once.",
];

const createUpdateAnnotationToolPrompts = (
  toolName: string,
  typeLabel: string,
  extraRule: string,
) => [
  `Use ${toolName} to move, resize when supported, restyle, or rewrite existing ${typeLabel} annotations by id.`,
  `${toolName} is patch-style: annotation_id is required, and every other field is optional. Only send the properties you want to change; do not resend the full annotation payload.`,
  `When updating one ${typeLabel} annotation, you may pass either a single object or an updates array.`,
  extraRule,
  "Call list_annotations first when annotation ids are unclear or when you need to confirm the current annotation type before editing.",
  "When placement or styling depends on page appearance, inspect the relevant page with get_pages_visual first.",
  AI_PAGE_COORDINATE_CONVENTION,
];

const UPDATE_HIGHLIGHT_ANNOTATIONS_TOOL_PROMPTS =
  createUpdateAnnotationToolPrompts(
    "update_highlight_annotations",
    "highlight",
    "Only highlight-compatible properties are allowed: text, rect, color, and opacity. Prefer update_annotation_texts when the task is limited to note/comment text.",
  );

const UPDATE_FREETEXT_ANNOTATIONS_TOOL_PROMPTS =
  createUpdateAnnotationToolPrompts(
    "update_freetext_annotations",
    "free text",
    "Only free-text-compatible properties are allowed: text, rect, color, opacity, background_color, border_color, border_width, font_size, font_family, line_height, alignment, flatten, and rotation_deg.",
  );

const UPDATE_SHAPE_ANNOTATIONS_TOOL_PROMPTS = createUpdateAnnotationToolPrompts(
  "update_shape_annotations",
  "shape",
  "Only shape-compatible properties are allowed: text, rect, color, opacity, background_color, background_opacity, thickness, arrow_size, start_arrow_style, end_arrow_style, cloud_intensity, and cloud_spacing.",
);

const toRectPatch = (
  rect:
    | {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      }
    | undefined,
) =>
  rect
    ? {
        ...(rect.x !== undefined ? { x: rect.x } : null),
        ...(rect.y !== undefined ? { y: rect.y } : null),
        ...(rect.width !== undefined ? { width: rect.width } : null),
        ...(rect.height !== undefined ? { height: rect.height } : null),
      }
    : undefined;

const summarizeAnnotationUpdateResult = (
  toolName: string,
  result: AiAnnotationUpdateResult,
) =>
  result.updatedCount > 0
    ? result.unchangedCount > 0 || result.rejectedCount > 0
      ? `Updated ${result.updatedCount} annotation${result.updatedCount === 1 ? "" : "s"}, ${result.unchangedCount} unchanged, ${result.rejectedCount} rejected`
      : `Updated ${result.updatedCount} annotation${result.updatedCount === 1 ? "" : "s"}`
    : `${toolName} completed with no changes`;

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

  update_highlight_annotations: createToolBuilder(
    "update_highlight_annotations",
  )
    .write()
    .description(
      "Update existing highlight annotations by id. Supports note text, page-space translation, and highlight-compatible appearance changes.",
    )
    .promptInstructions(UPDATE_HIGHLIGHT_ANNOTATIONS_TOOL_PROMPTS)
    .inputSchema(updateHighlightAnnotationsArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const result = toolCtx.updateAnnotations({
        updates: args.updates.map((item) => ({
          annotationId: item.annotation_id.trim(),
          annotationType: "highlight",
          text: item.text,
          rect: toRectPatch(item.rect),
          style: item.style
            ? {
                color: item.style.color,
                opacity: item.style.opacity,
              }
            : undefined,
        })),
      });

      return {
        payload: result,
        summary: summarizeAnnotationUpdateResult(
          "update_highlight_annotations",
          result,
        ),
      };
    }),

  update_freetext_annotations: createToolBuilder("update_freetext_annotations")
    .write()
    .description(
      "Update existing free text annotations by id. Supports visible text content, page-space geometry, and free-text-compatible appearance changes.",
    )
    .promptInstructions(UPDATE_FREETEXT_ANNOTATIONS_TOOL_PROMPTS)
    .inputSchema(updateFreetextAnnotationsArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const result = toolCtx.updateAnnotations({
        updates: args.updates.map((item) => ({
          annotationId: item.annotation_id.trim(),
          annotationType: "freetext",
          text: item.text,
          rect: toRectPatch(item.rect),
          style: item.style
            ? {
                color: item.style.color,
                opacity: item.style.opacity,
                backgroundColor: item.style.background_color,
                borderColor: item.style.border_color,
                borderWidth: item.style.border_width,
                fontSize: item.style.font_size,
                fontFamily: item.style.font_family,
                lineHeight: item.style.line_height,
                alignment: item.style.alignment,
                flatten: item.style.flatten,
                rotationDeg: item.style.rotation_deg,
              }
            : undefined,
        })),
      });

      return {
        payload: result,
        summary: summarizeAnnotationUpdateResult(
          "update_freetext_annotations",
          result,
        ),
      };
    }),

  update_shape_annotations: createToolBuilder("update_shape_annotations")
    .write()
    .description(
      "Update existing shape annotations by id. Supports note text, page-space geometry, and shape-compatible appearance changes.",
    )
    .promptInstructions(UPDATE_SHAPE_ANNOTATIONS_TOOL_PROMPTS)
    .inputSchema(updateShapeAnnotationsArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const result = toolCtx.updateAnnotations({
        updates: args.updates.map((item) => ({
          annotationId: item.annotation_id.trim(),
          annotationType: "shape",
          text: item.text,
          rect: toRectPatch(item.rect),
          style: item.style
            ? {
                color: item.style.color,
                opacity: item.style.opacity,
                backgroundColor: item.style.background_color,
                backgroundOpacity: item.style.background_opacity,
                thickness: item.style.thickness,
                arrowSize: item.style.arrow_size,
                startArrowStyle: item.style.start_arrow_style,
                endArrowStyle: item.style.end_arrow_style,
                cloudIntensity: item.style.cloud_intensity,
                cloudSpacing: item.style.cloud_spacing,
              }
            : undefined,
        })),
      });

      return {
        payload: result,
        summary: summarizeAnnotationUpdateResult(
          "update_shape_annotations",
          result,
        ),
      };
    }),

  create_freetext_annotations: createToolBuilder("create_freetext_annotations")
    .write()
    .requiresInputModalities(["image"])
    .description(
      "Create one or more free text annotations in actual page coordinates. Use this for visible notes, labels, callouts, or text overlays placed on the PDF page.",
    )
    .promptInstructions(CREATE_FREETEXT_ANNOTATIONS_TOOL_PROMPTS)
    .inputSchema(createFreetextAnnotationsArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const result = toolCtx.createFreetextAnnotations({
        annotations: args.annotations.map((item) => ({
          pageNumber: item.page_number,
          text: item.text,
          rect: item.rect
            ? {
                x: item.rect.x,
                y: item.rect.y,
                width: item.rect.width,
                height: item.rect.height,
              }
            : undefined,
          style: item.style
            ? {
                color: item.style.color,
                opacity: item.style.opacity,
                backgroundColor: item.style.background_color,
                borderColor: item.style.border_color,
                borderWidth: item.style.border_width,
                fontSize: item.style.font_size,
                fontFamily: item.style.font_family,
                lineHeight: item.style.line_height,
                alignment: item.style.alignment,
                flatten: item.style.flatten,
                rotationDeg: item.style.rotation_deg,
              }
            : undefined,
        })),
      });

      return {
        payload: result,
        summary:
          result.createdCount > 0
            ? result.skippedCount > 0 || result.rejectedCount > 0
              ? `Created ${result.createdCount} free text annotation${result.createdCount === 1 ? "" : "s"}, ${result.skippedCount} skipped, ${result.rejectedCount} rejected`
              : `Created ${result.createdCount} free text annotation${result.createdCount === 1 ? "" : "s"}`
            : "create_freetext_annotations completed with no creations",
      };
    }),

  create_shape_annotations: createToolBuilder("create_shape_annotations")
    .write()
    .requiresInputModalities(["image"])
    .description(
      "Create one or more shape annotations in actual page coordinates. Supports square, circle, line, polyline, polygon, cloud_polygon, arrow, and cloud shapes.",
    )
    .promptInstructions(CREATE_SHAPE_ANNOTATIONS_TOOL_PROMPTS)
    .inputSchema(createShapeAnnotationsArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const result = toolCtx.createShapeAnnotations({
        annotations: args.annotations.map((item) => ({
          pageNumber: item.page_number,
          shapeType: item.shape_type,
          rect: item.rect
            ? {
                x: item.rect.x,
                y: item.rect.y,
                width: item.rect.width,
                height: item.rect.height,
              }
            : undefined,
          points: item.points?.map((point) => ({
            x: point.x,
            y: point.y,
          })),
          annotationText: item.annotation_text,
          style: item.style
            ? {
                color: item.style.color,
                opacity: item.style.opacity,
                backgroundColor: item.style.background_color,
                backgroundOpacity: item.style.background_opacity,
                thickness: item.style.thickness,
                arrowSize: item.style.arrow_size,
                startArrowStyle: item.style.start_arrow_style,
                endArrowStyle: item.style.end_arrow_style,
                cloudIntensity: item.style.cloud_intensity,
                cloudSpacing: item.style.cloud_spacing,
              }
            : undefined,
        })),
      });

      return {
        payload: result,
        summary:
          result.createdCount > 0
            ? result.skippedCount > 0 || result.rejectedCount > 0
              ? `Created ${result.createdCount} shape annotation${result.createdCount === 1 ? "" : "s"}, ${result.skippedCount} skipped, ${result.rejectedCount} rejected`
              : `Created ${result.createdCount} shape annotation${result.createdCount === 1 ? "" : "s"}`
            : "create_shape_annotations completed with no creations",
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

  delete_annotations: createToolBuilder("delete_annotations")
    .write()
    .description(
      "Delete one or more existing annotations by id. Always use annotation_ids; it may be either a single id string or an array of id strings. Use list_annotations first when you need to locate the target annotation ids.",
    )
    .promptInstructions(DELETE_ANNOTATIONS_TOOL_PROMPTS)
    .inputSchema(deleteAnnotationsArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const result = toolCtx.deleteAnnotations({
        annotationIds: args.annotation_ids.map((annotationId) =>
          annotationId.trim(),
        ),
      });

      return {
        payload: result,
        summary:
          result.deletedCount > 0
            ? result.rejectedCount > 0
              ? `Deleted ${result.deletedCount} annotation${result.deletedCount === 1 ? "" : "s"}, ${result.rejectedCount} rejected`
              : `Deleted ${result.deletedCount} annotation${result.deletedCount === 1 ? "" : "s"}`
            : "delete_annotations completed with no deletions",
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
