import {
  createToolBuilder,
  defineToolModule,
  fillFormFieldsArgsSchema,
} from "./shared";

const FILL_FORM_FIELDS_TOOL_PROMPTS = [
  "For fill_form_fields, send value for text or dropdown fields, an array for multi-select dropdowns, and checked for checkbox or radio fields. Only use a custom dropdown string when allow_custom_value is true. Never fill signature fields.",
  "If the intended values come from annotations or review comments, inspect list_annotations first and map those instructions to field ids from list_fields.",
];

export const formToolModule = defineToolModule((_ctx) => ({
  fill_form_fields: createToolBuilder("fill_form_fields")
    .write()
    .description(
      "Fill existing PDF form fields by id. Supports text, dropdown, checkbox, and radio fields. Use list_fields first when ids or options are unclear, and inspect list_annotations first when comments or highlights contain the filling instructions.",
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
}));
