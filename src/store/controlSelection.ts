import type { EditorState } from "@/types";

/** Keep legacy single-control commands and document lifecycle writes consistent. */
export function normalizeControlSelection(
  previous: EditorState,
  patch: Partial<EditorState>,
): Pick<EditorState, "selectedId" | "selectedControlIds"> {
  if (
    ![
      "selectedId",
      "selectedControlIds",
      "fields",
      "annotations",
      "mode",
      "pdfBytes",
    ].some((key) => key in patch)
  ) {
    return {
      selectedId: previous.selectedId,
      selectedControlIds: previous.selectedControlIds,
    };
  }
  const fields = patch.fields ?? previous.fields;
  const annotations = patch.annotations ?? previous.annotations;
  let ids = patch.selectedControlIds ?? previous.selectedControlIds;
  if (!("selectedControlIds" in patch) && "selectedId" in patch) {
    ids =
      patch.selectedId == null
        ? []
        : patch.selectedId === previous.selectedId
          ? ids
          : [patch.selectedId];
    if (!ids.length && patch.selectedId) ids = [patch.selectedId];
  }
  if (
    (patch.mode !== undefined && patch.mode !== previous.mode) ||
    (patch.pdfBytes !== undefined && patch.pdfBytes !== previous.pdfBytes)
  ) {
    if (!("selectedControlIds" in patch) && !("selectedId" in patch)) ids = [];
  }
  const controls = new Map(
    [...fields, ...annotations].map((control) => [control.id, control]),
  );
  const first = ids.map((id) => controls.get(id)).find(Boolean);
  const fieldIds = new Set(fields.map((field) => field.id));
  const selected = [...new Set(ids)].filter((id) => {
    const control = controls.get(id);
    return (
      control &&
      first &&
      control.pageIndex === first.pageIndex &&
      fieldIds.has(id) === fieldIds.has(first.id)
    );
  });
  const preferred =
    patch.selectedId === undefined ? previous.selectedId : patch.selectedId;
  return {
    selectedId:
      preferred && selected.includes(preferred)
        ? preferred
        : (selected.at(-1) ?? null),
    selectedControlIds:
      selected.length === previous.selectedControlIds.length &&
      selected.every((id, index) => id === previous.selectedControlIds[index])
        ? previous.selectedControlIds
        : selected,
  };
}
