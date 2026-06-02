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

const inspectPagesVisualArgsSchema = z
  .object({
    pages: pageVisualTargetsSchema
      .optional()
      .default([])
      .describe(
        "Optional page visual requests. Each item may be a 1-based page number, a two-item inclusive range like [1, 22], or an object like { page, rect } to render a cropped page-space region. Defaults to the current page when omitted.",
      ),
    request: z
      .string()
      .optional()
      .describe(
        "Optional natural-language request describing what visual information to inspect and return. Ask for task-relevant regions, labels, field candidates, coordinates, or visual details as needed.",
      ),
  })
  .strict();

const getVisualInspectionRequest = (input: unknown) => {
  const record =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  return typeof record.request === "string" && record.request.trim()
    ? record.request.trim()
    : undefined;
};

const describeVisualInspectionRequest = (input: unknown) => {
  const request = getVisualInspectionRequest(input);
  const lines: string[] = [];

  if (request) {
    lines.push(`Inspection request: ${request}`);
  } else {
    lines.push(
      "Inspection request: inspect the task-relevant visual structure only.",
    );
  }

  lines.push(
    "If structure is useful, keep it compact and use only page, summary, region, text, and desc.",
  );
  lines.push(
    'Use short region types: text, table, image, form, signature, stamp, annotation, or other. Use box="x,y,width,height" in editor page-space coordinates as displayed to the user.',
  );

  return lines.join(" ");
};

const toPagesVisualModelOutput = (options: {
  input: unknown;
  output: unknown;
}) => {
  const { input, output } = options;
  if (typeof output === "string") {
    return {
      type: "text" as const,
      value: output.trim() || "Page visual result is empty.",
    };
  }

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

  const inspectionRequest = describeVisualInspectionRequest(input);
  if (inspectionRequest) {
    content.push({
      type: "text",
      text: inspectionRequest,
    });
  }

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
  "If the user asks about document metadata or PDF permissions/restrictions, call get_document_metadata.",
  "If the user asks to change PDF document metadata, call update_document_metadata. If the PDF is restricted and the owner password is provided, unlock permissions first.",
  "If the user explicitly provides a PDF owner password and asks to unlock permission restrictions, call unlock_pdf_permissions. Never invent or guess passwords.",
  "Do not reveal or repeat passwords in the assistant response.",
];

const MULTI_PAGE_SUMMARY_FALLBACK_PROMPT =
  "For whole-document or many-page summaries, call get_document_context first, then get_pages_text. Use page_numbers [[1, 10]] for pages 1-10; [1, 10] means only pages 1 and 10.";

const DOCUMENT_CONTEXT_TOOL_PROMPTS = [
  "get_document_context includes per-page type breakdowns for form fields and supported annotations on pages that actually contain them, which is useful before form filling or annotation inspection.",
  "get_document_context also includes the current viewport context: all visible pages intersecting the workspace viewport, page-space viewport rects for those visible pages, current zoom scale and percent, page layout mode, and page flow direction.",
];

const INSPECT_PAGE_VISUAL_TOOL_PROMPTS = [
  "If the task depends on full-page visual appearance, call inspect_pages_visual before making visual claims.",
  "inspect_pages_visual renders the current edited document state, not just the originally opened PDF bytes.",
  "Set request to the specific visual question or extraction target so the visual path returns only the information needed.",
  "When the result will be used for annotations, navigation, or form fields, ask in request for the relevant regions with editor page-space boxes and short labels.",
  "For form-building requests, ask inspect_pages_visual to identify form-like regions, labels, likely field types, and approximate boxes; then decide whether to call create_form_fields.",
  "Each inspect_pages_visual pages item may be a page number for a full-page image, a two-item inclusive range like [1, 22], or an object like { page, rect } to render only a page-space region.",
  `inspect_pages_visual uses a fixed pixel density of ${AI_CHAT_PAGE_IMAGE_PIXEL_DENSITY} px per page-space unit. Do not try to choose image size manually.`,
  AI_PAGE_COORDINATE_CONVENTION,
  "If get_pages_text or search_document returns empty text, OCR noise, or misses the needed content on a page, do not stop there. Call inspect_pages_visual for that page and inspect it visually.",
  "When the user asks about a page and the text layer is missing or unreliable, use inspect_pages_visual before concluding that the page content is unavailable.",
  "If you need several page visuals, prefer one inspect_pages_visual call with multiple pages over many tiny calls when possible.",
  "For text-only visual results, read the compact XML-like structure: page, summary, region, text, and desc. Treat region box values as approximate editor page-space coordinates.",
];

const nullableStringSchema = z.string().nullable();

const nullableDateStringSchema = nullableStringSchema.refine((value) => {
  if (value === null) return true;
  return Number.isFinite(new Date(value).getTime());
}, "Expected a parseable date/time string.");

const updateDocumentMetadataArgsSchema = z
  .object({
    title: nullableStringSchema
      .optional()
      .describe("Document title. Use null to clear it."),
    author: nullableStringSchema
      .optional()
      .describe("Document author. Use null to clear it."),
    subject: nullableStringSchema
      .optional()
      .describe("Document subject. Use null to clear it."),
    keywords: z
      .union([z.array(z.string()), z.string(), z.null()])
      .optional()
      .describe(
        "Document keywords as an array, a comma/semicolon-separated string, or null to clear them.",
      ),
    creator: nullableStringSchema
      .optional()
      .describe("Document creator/application. Use null to clear it."),
    producer: nullableStringSchema
      .optional()
      .describe(
        "Document producer. Supplying this also makes producer manual unless is_producer_manual is explicitly provided.",
      ),
    creation_date: nullableDateStringSchema
      .optional()
      .describe(
        "Creation date/time as a parseable date string. Use null to clear it.",
      ),
    modification_date: nullableDateStringSchema
      .optional()
      .describe(
        "Modification date/time as a parseable date string. Supplying this also makes modification date manual unless is_modification_date_manual is explicitly provided. Use null to clear it.",
      ),
    is_producer_manual: z
      .boolean()
      .optional()
      .describe("Whether the producer field should be written manually."),
    is_modification_date_manual: z
      .boolean()
      .optional()
      .describe("Whether the modification date should be written manually."),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one metadata field must be provided.",
  });

const hasOwn = <T extends object>(value: T, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(value, key);

const normalizeMetadataString = (value: string | null | undefined) =>
  value === null ? "" : value;

const normalizeMetadataKeywords = (
  value: string | string[] | null | undefined,
) => {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (Array.isArray(value)) {
    return value.map((keyword) => keyword.trim()).filter(Boolean);
  }
  return value
    .split(/[;,]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
};

const toMetadataUpdates = (
  args: z.output<typeof updateDocumentMetadataArgsSchema>,
) => {
  const updates: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
    creator?: string;
    producer?: string;
    creationDate?: string;
    modificationDate?: string;
    isProducerManual?: boolean;
    isModDateManual?: boolean;
  } = {};

  if (hasOwn(args, "title"))
    updates.title = normalizeMetadataString(args.title);
  if (hasOwn(args, "author")) {
    updates.author = normalizeMetadataString(args.author);
  }
  if (hasOwn(args, "subject")) {
    updates.subject = normalizeMetadataString(args.subject);
  }
  if (hasOwn(args, "keywords")) {
    updates.keywords = normalizeMetadataKeywords(args.keywords);
  }
  if (hasOwn(args, "creator")) {
    updates.creator = normalizeMetadataString(args.creator);
  }
  if (hasOwn(args, "producer")) {
    updates.producer = normalizeMetadataString(args.producer);
    if (args.is_producer_manual === undefined) {
      updates.isProducerManual = true;
    }
  }
  if (hasOwn(args, "creation_date")) {
    updates.creationDate = args.creation_date ?? undefined;
  }
  if (hasOwn(args, "modification_date")) {
    updates.modificationDate = args.modification_date ?? undefined;
    if (args.is_modification_date_manual === undefined) {
      updates.isModDateManual = true;
    }
  }
  if (args.is_producer_manual !== undefined) {
    updates.isProducerManual = args.is_producer_manual;
  }
  if (args.is_modification_date_manual !== undefined) {
    updates.isModDateManual = args.is_modification_date_manual;
  }

  return updates;
};

const summarizeMetadataUpdate = (payload: {
  status: "updated" | "unchanged";
  updatedFields: string[];
}) =>
  payload.status === "unchanged"
    ? "Document metadata unchanged"
    : `Updated document metadata: ${payload.updatedFields.join(", ")}`;

const unlockPdfPermissionsArgsSchema = z
  .object({
    password: z
      .string()
      .describe(
        "The PDF owner password explicitly provided by the user for this unlock attempt.",
      ),
    preserve_owner_restrictions_on_save: z
      .boolean()
      .optional()
      .describe(
        "Whether to preserve the original owner restrictions when saving after a successful unlock. Defaults to true on a new unlock.",
      ),
  })
  .strict();

const summarizeUnlockStatus = (payload: {
  ok: boolean;
  status: string;
  reason?: string;
}) => {
  if (payload.ok) {
    if (payload.status === "already_unlocked") {
      return "PDF permissions were already unlocked";
    }
    if (payload.status === "not_restricted") {
      return "PDF has no owner restrictions to unlock";
    }
    return "PDF permissions unlocked";
  }

  if (payload.status === "incorrect_password") {
    return "PDF permission unlock failed: incorrect owner password";
  }
  if (payload.status === "no_document") {
    return "PDF permission unlock failed: no document loaded";
  }
  return `PDF permission unlock failed: ${payload.reason ?? payload.status}`;
};

const GET_PAGES_TEXT_TOOL_PROMPTS = [
  "get_pages_text preserves inferred spaces and line breaks from the PDF while remaining compatible with anchor highlighting.",
  "get_pages_text may truncate at the user-configured text budget. If the result is truncated, call it again with fewer or narrower page_numbers before making claims about omitted content.",
  "For tables, forms, multi-column pages, or irregular layout, call get_pages_text with include_layout true before creating document anchors.",
  "When get_pages_text returns line data, prefer anchors that stay within one line or two adjacent lines instead of stitching distant layout regions together.",
  "If get_pages_text returns no useful text for a page and inspect_pages_visual is available, follow up with inspect_pages_visual instead of assuming the page has no usable content.",
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
  "When list_annotations returns stamp annotations, inspect stampKind, stampPresetId, stampLabel, and stampHasImage first; if you need the actual stamp graphic content, follow up with inspect_pages_visual.",
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

const summarizePageVisualBatchForPayload = (
  pageVisualBatch: AiRenderedPageImageBatch,
) => ({
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
  })),
});

const getDefaultPageVisualRequests = (documentContext: {
  currentPageNumber?: number | null;
  visiblePageNumbers?: number[];
}) =>
  [
    documentContext.currentPageNumber ??
      documentContext.visiblePageNumbers?.[0],
  ].filter(
    (pageNumber): pageNumber is number => typeof pageNumber === "number",
  );

const formatCharCount = (value: number) => `${value.toLocaleString()} chars`;

export const documentToolModule = defineToolModule((ctx) => {
  const inspectPagesVisual = ctx.inspectPagesVisual;
  const canAttachPageVisuals = ctx.canAttachPageVisuals?.() === true;

  return {
    get_document_context: createToolBuilder("get_document_context")
      .read()
      .description(
        "Get lightweight runtime context for the currently opened PDF document, including all pages currently visible in the workspace viewport, page-space viewport rects for visible pages, current zoom scale and percent, page layout mode, page flow direction, and per-page form-field and annotation type breakdowns only for pages that actually contain them.",
      )
      .promptInstructions([
        ...DOCUMENT_CONTEXT_TOOL_PROMPTS,
        MULTI_PAGE_SUMMARY_FALLBACK_PROMPT,
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
        "Get PDF document metadata such as filename, title, author, subject, keywords, creator, producer, creation/modification dates, current permission flags, whether owner restrictions are unlocked for this session, and whether original restrictions will be preserved on save.",
      )
      .promptInstructions(METADATA_TOOL_PROMPTS)
      .inputSchema(emptyObjectSchema)
      .build(async ({ ctx: toolCtx }) => {
        const payload = toolCtx.getDocumentMetadata();
        const availableKeys = Object.entries(payload).filter(([key, value]) => {
          if (
            [
              "permissions",
              "ownerRestrictionsUnlocked",
              "preserveOwnerRestrictionsOnSave",
            ].includes(key)
          ) {
            return false;
          }
          if (Array.isArray(value)) return value.length > 0;
          return value !== undefined && value !== null && value !== "";
        }).length;
        return {
          payload,
          summary: `Metadata with ${availableKeys} populated field${availableKeys === 1 ? "" : "s"};${payload.permissions.hasOwnerRestrictions ? " permissions restricted" : ""}${payload.ownerRestrictionsUnlocked ? " (owner unlocked)" : ""}`,
        };
      }),

    update_document_metadata: createToolBuilder("update_document_metadata")
      .write()
      .description(
        "Update PDF document metadata fields such as title, author, subject, keywords, creator, producer, creation date, and modification date. Requires document content modification permission; use unlock_pdf_permissions first when the user provided the owner password for a restricted PDF.",
      )
      .promptInstructions(METADATA_TOOL_PROMPTS)
      .inputSchema(updateDocumentMetadataArgsSchema)
      .build(async ({ args, ctx: toolCtx }) => {
        const payload = toolCtx.updateDocumentMetadata(toMetadataUpdates(args));
        return {
          payload,
          summary: summarizeMetadataUpdate(payload),
        };
      }),

    unlock_pdf_permissions: createToolBuilder("unlock_pdf_permissions")
      .write()
      .description(
        "Verify the PDF owner password provided by the user and unlock the current document's permission restrictions for this editing session. This does not open password-protected files; it only removes owner permission restrictions after the document is already open.",
      )
      .promptInstructions(METADATA_TOOL_PROMPTS)
      .inputSchema(unlockPdfPermissionsArgsSchema)
      .build(async ({ args, ctx: toolCtx }) => {
        const payload = await toolCtx.unlockPdfPermissions({
          password: args.password,
          preserveOwnerRestrictionsOnSave:
            args.preserve_owner_restrictions_on_save,
        });
        return {
          payload,
          summary: summarizeUnlockStatus(payload),
        };
      }),

    inspect_pages_visual: createToolBuilder("inspect_pages_visual")
      .enable(canAttachPageVisuals || Boolean(inspectPagesVisual))
      .read()
      .description(
        `Inspect one or more rendered PDF page visuals from the current edited document state. Use request to describe what visual information is needed, including task-relevant regions, labels, form-like areas, coordinates, or visual details. Image-capable chat models receive rendered page images directly; text-only chat models use the configured automatic visual model and get a compact XML-like visual structure. Returns at most ${AI_CHAT_MAX_PAGE_IMAGES_PER_CALL} visuals per call.`,
      )
      .promptInstructions(INSPECT_PAGE_VISUAL_TOOL_PROMPTS)
      .inputSchema(inspectPagesVisualArgsSchema)
      .toModelOutput(({ input, output }) =>
        toPagesVisualModelOutput({ input, output }),
      )
      .build(async ({ args, ctx: toolCtx, signal }) => {
        const documentContext = toolCtx.getDocumentContext();
        const pageRequests: PageVisualRequestArg[] =
          args.pages.length > 0
            ? (args.pages as PageVisualRequestArg[])
            : getDefaultPageVisualRequests(documentContext);
        const request = args.request?.trim() || undefined;

        if (pageRequests.length === 0) {
          return {
            payload: createErrorPayload(
              "NO_PAGE_AVAILABLE",
              "inspect_pages_visual requires at least one valid page request or an active page in the current document.",
            ),
            summary: "inspect_pages_visual failed: no page available",
          };
        }

        const canAttachVisualImages = toolCtx.canAttachPageVisuals?.() === true;

        if (canAttachVisualImages) {
          const pageVisualBatch = await toolCtx.getPagesVisual({
            pageNumbers: pageRequests,
            renderAnnotations: true,
            signal,
          });
          const pageVisualPayload =
            summarizePageVisualBatchForPayload(pageVisualBatch);
          const payload = {
            kind: "image_attachments",
            request,
            ...pageVisualPayload,
            pages: pageVisualPayload.pages.map((page) => ({
              ...page,
              imageAttachedForModel: true,
              modelAttachmentMode: "multimodal_tool_result",
            })),
          };

          return {
            payload,
            modelOutput: pageVisualBatch,
            summary: pageVisualBatch.truncated
              ? `Rendered ${pageVisualBatch.returnedPageCount} of ${pageVisualBatch.requestedPageCount} requested page visuals (limit ${pageVisualBatch.maxPagesPerCall})`
              : `Rendered ${pageVisualBatch.returnedPageCount} page visual${pageVisualBatch.returnedPageCount === 1 ? "" : "s"}`,
          };
        }

        if (!inspectPagesVisual) {
          return {
            payload: createErrorPayload(
              "NO_VISUAL_MODEL_AVAILABLE",
              "No direct image-capable chat path or configured visual model is available.",
            ),
            summary: "inspect_pages_visual failed: no visual model available",
          };
        }

        const visualAnalysis = await inspectPagesVisual({
          pageNumbers: pageRequests,
          renderAnnotations: true,
          request,
          signal,
        });

        const payload: AiRenderedPageVisualSummaryResult & {
          kind: "visual_analysis";
        } = {
          kind: "visual_analysis",
          requestedPageCount: visualAnalysis.requestedPageCount,
          returnedPageCount: visualAnalysis.returnedPageCount,
          truncated: visualAnalysis.truncated,
          maxPagesPerCall: visualAnalysis.maxPagesPerCall,
          request: visualAnalysis.request ?? request,
          pages: visualAnalysis.pages,
          summary: visualAnalysis.summary,
        };

        return {
          payload,
          modelOutput: payload.summary,
          summary: payload.truncated
            ? `Analyzed ${payload.returnedPageCount} of ${payload.requestedPageCount} requested rendered pages`
            : `Analyzed rendered page${payload.returnedPageCount === 1 ? "" : "s"} for ${payload.returnedPageCount} page${payload.returnedPageCount === 1 ? "" : "s"}`,
        };
      }),

    get_pages_text: createToolBuilder("get_pages_text")
      .read()
      .description(
        "Read full text for one or more pages. Text preserves PDF line breaks and inferred spaces. page_numbers is an array of selectors: use [[1, 20]] for pages 1-20; [1, 20] means only pages 1 and 20. Prefer the full relevant range, then narrow only if truncated. Optionally include per-line layout rectangles. The per-call text budget is configured in AI chat settings.",
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
