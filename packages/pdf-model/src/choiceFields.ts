import type { FormField } from "./types.js";

/** /Combo and /MultiSelect are independent PDF flags. Older editor models used
 * multiselect alone to mean an option list; retain that serialized behavior. */
export const isListBoxField = (
  field: Pick<FormField, "isListBox" | "isMultiSelect">,
): boolean => field.isListBox === true || field.isMultiSelect === true;
