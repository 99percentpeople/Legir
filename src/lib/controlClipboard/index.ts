import { getOrderedPageControls } from "@legir/pdf-model/controlLayerOrder";
import { detachFormFieldSource } from "@legir/pdf-model/formAppearance";
import { cloneAnnotationReplies } from "@legir/pdf-model/annotationReplies";
import {
  getMovedAnnotationUpdates,
  translateRect,
} from "@legir/pdf-model/controlMovement";
import { prepareInkAnnotationForStore } from "@legir/pdf-model/inkGeometry";
import { assertPdfPermissionOperation } from "@legir/pdf-model/pdfPermissions";
import type { EditorState, FormField, PageData } from "@/types";
import {
  controlClipboardSchema,
  controlClipboardPayloadSchema,
} from "./schema";
import type { ControlClipboard, ControlClipboardPayload } from "./types";

export const CONTROL_CLIPBOARD_MIME = "application/x-legir-control+json";
const TEXT_PREFIX = "Legir control v1\n";
const GROUP_TEXT_PREFIX = "Legir control v2\n";
const documentIds = new WeakMap<Uint8Array, string>();
const getDocumentId = (bytes: Uint8Array) => {
  let id = documentIds.get(bytes);
  if (!id) {
    id = crypto.randomUUID();
    documentIds.set(bytes, id);
  }
  return id;
};

export function copySelectedControl(
  state: EditorState,
  id = state.selectedId,
): ControlClipboard | null {
  if (!state.pdfBytes || state.mode === "pages") return null;
  const field = state.fields.find((item) => item.id === id);
  const annotation = state.annotations.find((item) => item.id === id);
  if (!field && !annotation) return null;
  assertPdfPermissionOperation("copy_text", state.documentPermissions);
  const data = field
    ? detachFormFieldSource(field)
    : prepareInkAnnotationForStore(annotation!);
  const result = controlClipboardSchema.safeParse({
    version: 1,
    sourceDocumentId: getDocumentId(state.pdfBytes),
    type: field ? "field" : "annotation",
    data,
  });
  // Parsing clones the snapshot and drops document-owned references/resources.
  return result.success ? result.data : null;
}

export function writeControlClipboard(
  data: Pick<DataTransfer, "setData">,
  control: ControlClipboardPayload,
) {
  const json = JSON.stringify(control);
  // Plain text is a portable fallback for WebViews/OSes that drop custom MIME.
  data.setData(
    "text/plain",
    (control.version === 2 ? GROUP_TEXT_PREFIX : TEXT_PREFIX) + json,
  );
  try {
    data.setData(CONTROL_CLIPBOARD_MIME, json);
  } catch {
    // The plain-text representation is sufficient to paste in another window.
  }
}

export function readControlClipboard(
  data: Pick<DataTransfer, "getData">,
): ControlClipboardPayload | null {
  try {
    let custom = "";
    try {
      custom = data.getData(CONTROL_CLIPBOARD_MIME);
    } catch {
      // Some WebViews only expose standard clipboard formats.
    }
    const plain = data.getData("text/plain");
    const json =
      custom ||
      (plain.startsWith(TEXT_PREFIX)
        ? plain.slice(TEXT_PREFIX.length)
        : plain.startsWith(GROUP_TEXT_PREFIX)
          ? plain.slice(GROUP_TEXT_PREFIX.length)
          : "");
    if (!json) return null;
    const result = controlClipboardPayloadSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function uniqueFieldName(name: string, fields: FormField[]) {
  const names = new Set(fields.map((field) => field.name));
  if (!names.has(name)) return name;
  const base = name.replace(/_\d+$/, "");
  let index = 1;
  while (names.has(`${base}_${index}`)) index++;
  return `${base}_${index}`;
}

/** Create a new control in page coordinates, keeping its full geometry together. */
export function preparePastedControl(
  clipboard: ControlClipboard,
  page: PageData,
  state: EditorState,
  position?: { x: number; y: number },
  clampToPage = true,
): ControlClipboard | null {
  const parsed = controlClipboardSchema.safeParse(clipboard);
  if (!parsed.success || !state.pdfBytes) return null;
  const control = parsed.data;
  // Imported ink rectangles can differ from their stroke bounds. Menu placement
  // anchors the rendered bounds, while keyboard paste retains its original offset.
  const rect =
    position && control.type === "annotation"
      ? prepareInkAnnotationForStore(control.data, { recomputeRect: true }).rect
      : control.data.rect;
  if (!rect) return null;
  if (
    position &&
    (!Number.isFinite(position.x) || !Number.isFinite(position.y))
  )
    return null;
  const x = position?.x ?? rect.x + 12;
  const y = position?.y ?? rect.y + 12;
  const dx =
    (clampToPage ? Math.max(0, Math.min(x, page.width - rect.width)) : x) -
    rect.x;
  const dy =
    (clampToPage ? Math.max(0, Math.min(y, page.height - rect.height)) : y) -
    rect.y;
  const id = crypto.randomUUID();
  if (control.type === "field") {
    return {
      ...control,
      data: {
        ...control.data,
        id,
        name: uniqueFieldName(control.data.name, state.fields),
        pageIndex: page.pageIndex,
        rect: translateRect(rect, dx, dy),
      },
    };
  }
  const annotation = control.data;
  return {
    ...control,
    data: prepareInkAnnotationForStore(
      {
        ...annotation,
        ...getMovedAnnotationUpdates(annotation, dx, dy),
        id,
        pageIndex: page.pageIndex,
        // An internal destination belongs to its source PDF, unlike a URL.
        linkDestPageIndex:
          control.sourceDocumentId === getDocumentId(state.pdfBytes)
            ? annotation.linkDestPageIndex
            : undefined,
        replies: cloneAnnotationReplies(annotation.replies, id, () =>
          crypto.randomUUID(),
        ),
      },
      { recomputeRect: true },
    ),
  };
}

/** A selected member's context menu copies the entire selection. */
export function copySelectedControls(
  state: EditorState,
  id = state.selectedId,
): ControlClipboardPayload | null {
  const ids =
    id && state.selectedControlIds.includes(id)
      ? state.selectedControlIds
      : id
        ? [id]
        : [];
  const selected = new Set(ids);
  const pageIndex = [...state.fields, ...state.annotations].find((control) =>
    selected.has(control.id),
  )?.pageIndex;
  const ordered =
    pageIndex === undefined
      ? []
      : getOrderedPageControls(
          state.fields,
          state.annotations,
          pageIndex,
        ).filter(({ control }) => selected.has(control.id));
  const controls = ordered.map(({ control }) =>
    copySelectedControl(state, control.id),
  );
  if (!controls.length || controls.some((control) => !control)) return null;
  const data = controls as ControlClipboard[];
  return data.length === 1 ? data[0] : { version: 2, type: "group", data };
}

/** Clamp the group once so objects keep their relative offsets at page edges. */
export function preparePastedControls(
  clipboard: ControlClipboardPayload,
  page: PageData,
  state: EditorState,
  position?: { x: number; y: number },
): ControlClipboard[] | null {
  const parsed = controlClipboardPayloadSchema.safeParse(clipboard);
  if (!parsed.success) return null;
  if (parsed.data.version === 1) {
    const control = preparePastedControl(parsed.data, page, state, position);
    return control ? [control] : null;
  }
  const controls = parsed.data.data;
  const rects = controls.map((control) =>
    control.type === "annotation"
      ? prepareInkAnnotationForStore(control.data, { recomputeRect: true }).rect
      : control.data.rect,
  );
  if (rects.some((rect) => !rect)) return null;
  const bounds = rects as NonNullable<(typeof rects)[number]>[];
  const x = Math.min(...bounds.map((rect) => rect.x));
  const y = Math.min(...bounds.map((rect) => rect.y));
  const width = Math.max(...bounds.map((rect) => rect.x + rect.width)) - x;
  const height = Math.max(...bounds.map((rect) => rect.y + rect.height)) - y;
  const dx =
    Math.max(0, Math.min(position?.x ?? x + 12, page.width - width)) - x;
  const dy =
    Math.max(0, Math.min(position?.y ?? y + 12, page.height - height)) - y;
  const fields = [...state.fields];
  const result: ControlClipboard[] = [];
  for (const [index, control] of controls.entries()) {
    const rect = bounds[index];
    const next = preparePastedControl(
      control,
      page,
      { ...state, fields },
      { x: rect.x + dx, y: rect.y + dy },
      false,
    );
    if (!next) return null;
    result.push(next);
    if (next.type === "field") fields.push(next.data);
  }
  return result;
}
