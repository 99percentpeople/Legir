import {
  createErrorPayload,
  createToolBuilder,
  defineToolModule,
  focusResultArgsSchema,
  navigatePageArgsSchema,
} from "./shared";

export const navigationToolModule = defineToolModule((_ctx) => ({
  navigate_page: createToolBuilder("navigate_page")
    .write()
    .description("Scroll the workspace to the top of a specific page.")
    .inputSchema(navigatePageArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const { page_number } = args;
      toolCtx.navigatePage(page_number - 1);
      return {
        payload: {
          ok: true,
          pageNumber: page_number,
        },
        summary: `Navigated to page ${page_number}`,
      };
    }),

  focus_result: createToolBuilder("focus_result")
    .write()
    .description(
      "Scroll the workspace to a previously returned search result id.",
    )
    .inputSchema(focusResultArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const resultId = args.result_id.trim();
      const stored = resultId ? toolCtx.getStoredSearchResult(resultId) : null;
      if (!stored) {
        return {
          payload: createErrorPayload(
            "RESULT_NOT_FOUND",
            "focus_result requires a valid result_id from search_document.",
          ),
          summary: "focus_result failed: result not found",
        };
      }

      toolCtx.focusSearchResult(stored.result);
      return {
        payload: {
          ok: true,
          resultId,
          pageNumber: stored.result.pageIndex + 1,
        },
        summary: `Focused result on page ${stored.result.pageIndex + 1}`,
      };
    }),
}));
