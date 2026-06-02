import {
  createFormFieldsArgsSchema,
  createToolBuilder,
  defineToolModule,
  fillFormFieldsArgsSchema,
  updateFormFieldsArgsSchema,
} from "./shared";
import type {
  AiCreateFormFieldsResult,
  AiFormFieldUpdateResult,
} from "@/services/ai/chat/types";
import { pruneUndefinedKeys } from "@/services/ai/utils/object";
import { AI_PAGE_COORDINATE_CONVENTION } from "@/services/ai/utils/pageCoordinates";

const FILL_FORM_FIELDS_TOOL_PROMPTS = [
  "For fill_form_fields, send value for text or dropdown fields, an array for multi-select dropdowns, and checked for checkbox or radio fields. Only use a custom dropdown string when allow_custom_value is true. Never fill signature fields.",
  "If the intended values come from annotations or review comments, inspect list_annotations first and map those instructions to field ids from list_fields.",
];

const CREATE_FORM_FIELDS_TOOL_PROMPTS = [
  "Only call create_form_fields after the user has explicitly confirmed the requirements in a follow-up message. Do not create fields in the same turn as the initial request.",
  "Use inspect_pages_visual before creating fields when geometry depends on page appearance. Ask it for form-like regions, labels, likely field types, and approximate page-space boxes.",
  "After confirmation, call create_form_fields with explicit fields derived from the visual structure or directly inspected page images.",
  AI_PAGE_COORDINATE_CONVENTION,
  "When passing fields directly, include actual page-space rects and the desired field properties. Do not convert or normalize coordinates beyond the true page coordinate space.",
];

const UPDATE_FORM_FIELDS_TOOL_PROMPTS = [
  "Use update_form_fields to change existing field properties, styles, or page-space geometry such as x, y, width, and height.",
  AI_PAGE_COORDINATE_CONVENTION,
  "Do not use update_form_fields for current field values. Use fill_form_fields for text, checkbox, radio, or dropdown values.",
  "Call list_fields first when field ids are unclear. Prefer include_layout true if the user refers to fields by page position or visual location.",
  "You may use update_form_fields to move or resize an existing field by updating rect in actual page coordinates. Do not use it to delete fields.",
];

const toDefinedStylePatch = (
  style:
    | {
        border_color?: string;
        background_color?: string;
        border_width?: number;
        border_style?: "solid" | "dashed" | "underline";
        text_color?: string;
        font_size?: number;
        font_family?: string;
        is_transparent?: boolean;
      }
    | undefined,
) => {
  return pruneUndefinedKeys(
    style
      ? {
          borderColor: style.border_color,
          backgroundColor: style.background_color,
          borderWidth: style.border_width,
          borderStyle: style.border_style,
          textColor: style.text_color,
          fontSize: style.font_size,
          fontFamily: style.font_family,
          isTransparent: style.is_transparent,
        }
      : undefined,
  );
};

const summarizeCreatedFormFields = (result: AiCreateFormFieldsResult) => {
  if (result.status === "not_found" || result.status === "rejected") {
    return result.reason || "Form field creation could not be completed";
  }
  const skippedLabel =
    result.skippedCount > 0 ? `, ${result.skippedCount} skipped` : "";
  const rejectedLabel =
    result.rejectedCount > 0 ? `, ${result.rejectedCount} rejected` : "";
  return `Created ${result.createdCount} field${result.createdCount === 1 ? "" : "s"}${skippedLabel}${rejectedLabel}`;
};

const summarizeUpdatedFormFields = (result: AiFormFieldUpdateResult) => {
  const unchangedLabel =
    result.unchangedCount > 0 ? `, ${result.unchangedCount} unchanged` : "";
  const rejectedLabel =
    result.rejectedCount > 0 ? `, ${result.rejectedCount} rejected` : "";
  return `Updated ${result.updatedCount} field${result.updatedCount === 1 ? "" : "s"}${unchangedLabel}${rejectedLabel}`;
};

export const formToolModule = defineToolModule((ctx) => ({
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

  update_form_fields: createToolBuilder("update_form_fields")
    .enable(ctx.formToolsEnabled)
    .write()
    .description(
      "Update existing PDF form field properties, styles, or page-space geometry by field id. Supports appearance changes, common field properties, and rect updates for moving or resizing fields in actual page coordinates.",
    )
    .promptInstructions(UPDATE_FORM_FIELDS_TOOL_PROMPTS)
    .inputSchema(updateFormFieldsArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const result = toolCtx.updateFormFields({
        updates: args.updates.map((item) => ({
          fieldId: item.field_id.trim(),
          rect: item.rect
            ? {
                ...(item.rect.x !== undefined ? { x: item.rect.x } : null),
                ...(item.rect.y !== undefined ? { y: item.rect.y } : null),
                ...(item.rect.width !== undefined
                  ? { width: item.rect.width }
                  : null),
                ...(item.rect.height !== undefined
                  ? { height: item.rect.height }
                  : null),
              }
            : undefined,
          required: item.required,
          readOnly: item.read_only,
          toolTip: item.tool_tip,
          placeholder: item.placeholder,
          options: item.options,
          multiline: item.multiline,
          alignment: item.alignment,
          isMultiSelect: item.is_multi_select,
          allowCustomValue: item.allow_custom_value,
          exportValue: item.export_value,
          style: toDefinedStylePatch(item.style),
        })),
      });

      return {
        payload: result,
        summary: summarizeUpdatedFormFields(result),
      };
    }),

  create_form_fields: createToolBuilder("create_form_fields")
    .enable(ctx.formToolsEnabled)
    .write()
    .description(
      "Create new PDF form fields from explicit field definitions that already use actual page coordinates.",
    )
    .promptInstructions(CREATE_FORM_FIELDS_TOOL_PROMPTS)
    .inputSchema(createFormFieldsArgsSchema)
    .build(async ({ args, ctx: toolCtx }) => {
      const result = toolCtx.createFormFields({
        fields: args.fields.map((field) => ({
          pageNumber: field.page_number,
          name: field.name,
          type: field.type,
          rect: {
            x: field.rect.x,
            y: field.rect.y,
            width: field.rect.width,
            height: field.rect.height,
          },
          required: field.required,
          readOnly: field.read_only,
          toolTip: field.tool_tip,
          placeholder: field.placeholder,
          options: field.options,
          multiline: field.multiline,
          alignment: field.alignment,
          isMultiSelect: field.is_multi_select,
          allowCustomValue: field.allow_custom_value,
          exportValue: field.export_value,
          style: toDefinedStylePatch(field.style),
        })),
      });

      return {
        payload: result,
        summary: summarizeCreatedFormFields(result),
      };
    }),
}));
