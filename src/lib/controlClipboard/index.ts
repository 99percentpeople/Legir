import { cloneAnnotationReplies } from "@/lib/annotationReplies";
import {
  getMovedAnnotationUpdates,
  translateRect,
} from "@/lib/controlMovement";
import { prepareInkAnnotationForStore } from "@/lib/inkGeometry";
import { assertPdfPermissionOperation } from "@/lib/pdfPermissions";
import type { EditorState, FormField, PageData } from "@/types";
import { controlClipboardSchema } from "./schema";
import type { ControlClipboard } from "./types";

export const CONTROL_CLIPBOARD_MIME = "application/x-legir-control+json";
const TEXT_PREFIX = "Legir control v1\n";
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
): ControlClipboard | null {
  if (!state.pdfBytes || state.mode === "pages") return null;
  const field = state.fields.find((item) => item.id === state.selectedId);
  const annotation = state.annotations.find(
    (item) => item.id === state.selectedId,
  );
  if (!field && !annotation) return null;
  assertPdfPermissionOperation("copy_text", state.documentPermissions);
  const data = field ?? prepareInkAnnotationForStore(annotation!);
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
  data: DataTransfer,
  control: ControlClipboard,
) {
  const json = JSON.stringify(control);
  // Plain text is a portable fallback for WebViews/OSes that drop custom MIME.
  data.setData("text/plain", TEXT_PREFIX + json);
  try {
    data.setData(CONTROL_CLIPBOARD_MIME, json);
  } catch {
    // The plain-text representation is sufficient to paste in another window.
  }
}

export function readControlClipboard(
  data: DataTransfer,
): ControlClipboard | null {
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
      (plain.startsWith(TEXT_PREFIX) ? plain.slice(TEXT_PREFIX.length) : "");
    if (!json) return null;
    const result = controlClipboardSchema.safeParse(JSON.parse(json));
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
): ControlClipboard | null {
  const parsed = controlClipboardSchema.safeParse(clipboard);
  if (!parsed.success || !state.pdfBytes) return null;
  const control = parsed.data;
  const rect = control.data.rect;
  if (!rect) return null;
  const dx =
    Math.max(0, Math.min(rect.x + 12, page.width - rect.width)) - rect.x;
  const dy =
    Math.max(0, Math.min(rect.y + 12, page.height - rect.height)) - rect.y;
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
