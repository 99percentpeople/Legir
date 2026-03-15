import type { AiToolExecutionContext } from "@/services/ai/chat/types";

import {
  createErrorPayload,
  createInvalidArgumentsResult,
  defineTool,
  fillFormFieldsArgsSchema,
  focusFieldArgsSchema,
  listFormFieldsArgsSchema,
  parseToolArgs,
  summarizeListedFormFields,
  type AiToolHandlerMap,
} from "./shared";

export const createFormToolHandlers = (
  ctx: AiToolExecutionContext,
): AiToolHandlerMap<
  "list_form_fields" | "fill_form_fields" | "focus_field"
> => ({
  list_form_fields: {
    definition: defineTool("read", {
      name: "list_form_fields",
      description:
        "List existing PDF form fields that the AI can inspect before filling. Returns field ids, types, page numbers, current values, and available options.",
      inputSchema: listFormFieldsArgsSchema,
    }),
    execute: async (rawArgs) => {
      const parsed = parseToolArgs(listFormFieldsArgsSchema, rawArgs);
      if (parsed.success === false) {
        return createInvalidArgumentsResult("list_form_fields", parsed.error);
      }

      const args = parsed.data;
      const result = ctx.listFormFields({
        pageNumbers: args.page_numbers,
        query: args.query?.trim() || undefined,
        onlyEmpty: args.only_empty,
        includeReadOnly: args.include_read_only,
        maxResults: args.max_results,
      });

      return {
        payload: result,
        summary: summarizeListedFormFields(result.total, result.returned),
      };
    },
  },

  fill_form_fields: {
    definition: defineTool("write", {
      name: "fill_form_fields",
      description:
        "Fill existing PDF form fields by id. Supports text, dropdown, checkbox, and radio fields. Use list_form_fields first when ids or options are unclear.",
      inputSchema: fillFormFieldsArgsSchema,
    }),
    execute: async (rawArgs) => {
      const parsed = parseToolArgs(fillFormFieldsArgsSchema, rawArgs);
      if (parsed.success === false) {
        return createInvalidArgumentsResult("fill_form_fields", parsed.error);
      }

      const updates = parsed.data.updates.map((item) => ({
        fieldId: item.field_id.trim(),
        ...(item.value !== undefined ? { value: item.value } : null),
        ...(typeof item.checked === "boolean"
          ? { checked: item.checked }
          : null),
      }));

      const result = ctx.fillFormFields({ updates });
      return {
        payload: result,
        summary:
          result.rejectedCount > 0
            ? `Filled ${result.updatedCount} field${result.updatedCount === 1 ? "" : "s"}, ${result.rejectedCount} rejected`
            : `Filled ${result.updatedCount} field${result.updatedCount === 1 ? "" : "s"}`,
      };
    },
  },

  focus_field: {
    definition: defineTool("write", {
      name: "focus_field",
      description:
        "Focus an existing form field by id and scroll it into view.",
      inputSchema: focusFieldArgsSchema,
    }),
    execute: async (rawArgs) => {
      const parsed = parseToolArgs(focusFieldArgsSchema, rawArgs);
      if (parsed.success === false) {
        return createInvalidArgumentsResult("focus_field", parsed.error);
      }

      const fieldId = parsed.data.field_id.trim();
      const field = fieldId ? ctx.focusField(fieldId) : null;
      if (!field) {
        return {
          payload: createErrorPayload(
            "FIELD_NOT_FOUND",
            "focus_field requires a valid field_id from list_form_fields.",
          ),
          summary: "focus_field failed: field not found",
        };
      }

      return {
        payload: {
          ok: true,
          field,
        },
        summary: `Focused field on page ${field.pageNumber}`,
      };
    },
  },
});
