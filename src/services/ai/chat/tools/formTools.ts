import {
  createErrorPayload,
  createToolBuilder,
  defineToolModule,
  fillFormFieldsArgsSchema,
  focusFieldArgsSchema,
  listFormFieldsArgsSchema,
  summarizeListedFormFields,
} from "./shared";

const LIST_FORM_FIELDS_TOOL_PROMPTS = [
  "If the user asks to fill or update form fields and ids, options, or field mapping are unclear, call list_form_fields first.",
];

const FILL_FORM_FIELDS_TOOL_PROMPTS = [
  "For fill_form_fields, send value for text or dropdown fields, an array for multi-select dropdowns, and checked for checkbox or radio fields. Only use a custom dropdown string when allow_custom_value is true. Never fill signature fields.",
];

export const formToolModule = defineToolModule((_ctx) => ({
  list_form_fields: createToolBuilder("list_form_fields")
    .read()
    .description(
      "List existing PDF form fields that the AI can inspect before filling. Returns field ids, types, page numbers, current values, and available options.",
    )
    .promptInstructions(LIST_FORM_FIELDS_TOOL_PROMPTS)
    .inputSchema(listFormFieldsArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const result = toolCtx.listFormFields({
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
    }),

  fill_form_fields: createToolBuilder("fill_form_fields")
    .write()
    .description(
      "Fill existing PDF form fields by id. Supports text, dropdown, checkbox, and radio fields. Use list_form_fields first when ids or options are unclear.",
    )
    .promptInstructions(FILL_FORM_FIELDS_TOOL_PROMPTS)
    .inputSchema(fillFormFieldsArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const updates = args.updates.map((item) => ({
        fieldId: item.field_id.trim(),
        ...(item.value !== undefined ? { value: item.value } : null),
        ...(typeof item.checked === "boolean"
          ? { checked: item.checked }
          : null),
      }));

      const result = toolCtx.fillFormFields({ updates });
      return {
        payload: result,
        summary:
          result.rejectedCount > 0
            ? `Filled ${result.updatedCount} field${result.updatedCount === 1 ? "" : "s"}, ${result.rejectedCount} rejected`
            : `Filled ${result.updatedCount} field${result.updatedCount === 1 ? "" : "s"}`,
      };
    }),

  focus_field: createToolBuilder("focus_field")
    .write()
    .description("Focus an existing form field by id and scroll it into view.")
    .inputSchema(focusFieldArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const fieldId = args.field_id.trim();
      const field = fieldId ? toolCtx.focusField(fieldId) : null;
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
    }),
}));
