import {
  createErrorPayload,
  createToolBuilder,
  defineToolModule,
  focusControlArgsSchema,
  focusResultArgsSchema,
  navigatePageArgsSchema,
} from "./shared";

const NAVIGATE_PAGE_TOOL_PROMPTS = [
  "Use navigate_page only when the user explicitly asks you to go to a page now. If you are only referencing a page in the answer, prefer a clickable page link instead.",
];

const FOCUS_CONTROL_TOOL_PROMPTS = [
  "Use focus_control only when the user explicitly asks you to open, focus, or select a specific field or annotation now. If the user mainly needs guidance, answer with a natural clickable control link instead.",
];

const FOCUS_RESULT_TOOL_PROMPTS = [
  "Use focus_result only when the user explicitly asks you to jump to a search hit now. Otherwise prefer a clickable result link so the user can choose when to open it.",
];

export const navigationToolModule = defineToolModule((_ctx) => ({
  navigate_page: createToolBuilder("navigate_page")
    .write()
    .description("Scroll the workspace to the top of a specific page.")
    .promptInstructions(NAVIGATE_PAGE_TOOL_PROMPTS)
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

  focus_control: createToolBuilder("focus_control")
    .write()
    .description(
      "Focus an existing field or annotation by id and scroll it into view. Use control_id from list_fields or list_annotations. Optionally set select true if the control should also become selected.",
    )
    .promptInstructions(FOCUS_CONTROL_TOOL_PROMPTS)
    .inputSchema(focusControlArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const control = args.control_id.trim()
        ? toolCtx.focusControl(args.control_id.trim(), {
            select: args.select,
          })
        : null;
      if (!control) {
        return {
          payload: createErrorPayload(
            "CONTROL_NOT_FOUND",
            "focus_control requires a valid control_id from list_fields or list_annotations.",
          ),
          summary: "focus_control failed: control not found",
        };
      }

      return {
        payload: {
          ok: true,
          selected: args.select,
          ...control,
        },
        summary: `Focused ${control.controlType} on page ${control.pageNumber}`,
      };
    }),

  focus_result: createToolBuilder("focus_result")
    .write()
    .description(
      "Scroll the workspace to a previously returned search result id.",
    )
    .promptInstructions(FOCUS_RESULT_TOOL_PROMPTS)
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
