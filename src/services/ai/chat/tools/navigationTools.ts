import {
  createErrorPayload,
  createToolBuilder,
  defineToolModule,
  navigateArgsSchema,
} from "./shared";

export const navigationToolModule = defineToolModule((_ctx) => ({
  navigate: createToolBuilder("navigate")
    .write()
    .description(
      "Navigate to a page, field/annotation, or remembered search hit. Use control_id from list_fields/list_annotations or result_id from search_document. Select exactly one target type.",
    )
    .promptInstructions([
      "Use navigate only when the user explicitly asks you to jump, focus, or select now. For references in answers, prefer clickable document links.",
    ])
    .inputSchema(navigateArgsSchema)
    .build(async ({ args: { target }, ctx, signal }) => {
      switch (target.type) {
        case "page": {
          const { page_number } = target;
          const { pageCount } = ctx.getDocumentContext();
          if (page_number > pageCount) {
            return {
              payload: createErrorPayload(
                "INVALID_PAGE",
                `Page must be between 1 and ${pageCount}.`,
              ),
              summary: "navigate failed: page out of range",
            };
          }
          ctx.navigatePage(page_number - 1);
          return {
            payload: { ok: true, pageNumber: page_number },
            summary: `Navigated to page ${page_number}`,
          };
        }
        case "control": {
          const control = ctx.focusControl(target.control_id, {
            select: target.select,
          });
          if (!control) {
            return {
              payload: createErrorPayload(
                "CONTROL_NOT_FOUND",
                "Use a valid control_id from list_fields or list_annotations.",
              ),
              summary: "navigate failed: control not found",
            };
          }
          return {
            payload: { ok: true, selected: target.select, ...control },
            summary: `Focused ${control.controlType} on page ${control.pageNumber}`,
          };
        }
        case "result": {
          const stored = ctx.getStoredSearchResult(target.result_id);
          if (!stored) {
            return {
              payload: createErrorPayload(
                "RESULT_NOT_FOUND",
                "Use a valid result_id from search_document.",
              ),
              summary: "navigate failed: result not found",
            };
          }
          await ctx.focusSearchResult(stored.result, signal);
          return {
            payload: {
              ok: true,
              resultId: target.result_id,
              pageNumber: stored.result.pageIndex + 1,
            },
            summary: `Focused result on page ${stored.result.pageIndex + 1}`,
          };
        }
      }
    }),
}));
