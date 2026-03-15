import type { AiToolExecutionContext } from "@/services/ai/chat/types";

import {
  createErrorPayload,
  createInvalidArgumentsResult,
  defineTool,
  focusResultArgsSchema,
  navigatePageArgsSchema,
  parseToolArgs,
  type AiToolHandlerMap,
} from "./shared";

export const createNavigationToolHandlers = (
  ctx: AiToolExecutionContext,
): AiToolHandlerMap<"navigate_page" | "focus_result"> => ({
  navigate_page: {
    definition: defineTool("write", {
      name: "navigate_page",
      description: "Scroll the workspace to the top of a specific page.",
      inputSchema: navigatePageArgsSchema,
    }),
    execute: async (rawArgs) => {
      const parsed = parseToolArgs(navigatePageArgsSchema, rawArgs);
      if (parsed.success === false) {
        return createInvalidArgumentsResult("navigate_page", parsed.error);
      }

      const { page_number } = parsed.data;
      ctx.navigatePage(page_number - 1);
      return {
        payload: {
          ok: true,
          pageNumber: page_number,
        },
        summary: `Navigated to page ${page_number}`,
      };
    },
  },

  focus_result: {
    definition: defineTool("write", {
      name: "focus_result",
      description:
        "Scroll the workspace to a previously returned search result id.",
      inputSchema: focusResultArgsSchema,
    }),
    execute: async (rawArgs) => {
      const parsed = parseToolArgs(focusResultArgsSchema, rawArgs);
      if (parsed.success === false) {
        return createInvalidArgumentsResult("focus_result", parsed.error);
      }

      const resultId = parsed.data.result_id.trim();
      const stored = resultId ? ctx.getStoredSearchResult(resultId) : null;
      if (!stored) {
        return {
          payload: createErrorPayload(
            "RESULT_NOT_FOUND",
            "focus_result requires a valid result_id from search_document.",
          ),
          summary: "focus_result failed: result not found",
        };
      }

      ctx.focusSearchResult(stored.result);
      return {
        payload: {
          ok: true,
          resultId,
          pageNumber: stored.result.pageIndex + 1,
        },
        summary: `Focused result on page ${stored.result.pageIndex + 1}`,
      };
    },
  },
});
