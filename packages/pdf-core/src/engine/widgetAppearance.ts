import {
  PDFName,
  PDFWidgetAnnotation,
  getButtonIconBounds,
  type PDFDocument,
  type PDFStream,
  type PDFRef,
} from "@legir/pdfium/authoring";
import { getEditingView } from "./editingDocument.js";

const pngDataUrl = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:image/png;base64,${btoa(binary)}`;
};

const nativePagesByView = new WeakMap<object, Map<number, number>>();

/** Imported source views use virtual references and their own page order. */
function resolveNativePage(
  view: NonNullable<ReturnType<typeof getEditingView>>,
  document: PDFDocument,
  index: number,
) {
  const ref = view.actual(document.getPage(index).ref.objectNumber);
  if (index < view.native.countPages()) {
    const candidate = view.native.findPage(index);
    try {
      if (candidate.asIndirect() === ref) return index;
    } finally {
      candidate.destroy();
    }
  }
  let pages = nativePagesByView.get(view);
  if (!pages) {
    pages = new Map();
    for (let i = 0; i < view.native.countPages(); i++) {
      const page = view.native.findPage(i);
      try {
        pages.set(page.asIndirect(), i);
      } finally {
        page.destroy();
      }
    }
    nativePagesByView.set(view, pages);
  }
  const actual = pages.get(ref);
  if (actual === undefined)
    throw new Error("Widget page is not part of the native source document");
  return actual;
}

/** A bounded, transparent crop of one widget, using its existing native owner. */
export async function renderWidgetAppearance(
  document: PDFDocument,
  pageIndex: number,
  widget: PDFWidgetAnnotation,
  ref: PDFRef,
): Promise<string | undefined> {
  const view = getEditingView(document);
  if (!view || !widget.getAppearances().normal) return undefined;
  const r = widget.getRectangle();
  if (
    ![r.x, r.y, r.width, r.height].every(Number.isFinite) ||
    r.width <= 0 ||
    r.height <= 0
  )
    return undefined;
  const rotation =
    (((widget.getAppearanceCharacteristics()?.getRotation() ?? 0) % 360) +
      360) %
    360;
  const scale = Math.min(2, 1024 / Math.max(r.width, r.height));
  const width = Math.max(
    1,
    Math.ceil((rotation % 180 ? r.height : r.width) * scale),
  );
  const height = Math.max(
    1,
    Math.ceil((rotation % 180 ? r.width : r.height) * scale),
  );
  // Invert the widget's own rotation; the editor wrapper applies page/widget rotation once.
  const matrix: [number, number, number, number, number, number] =
    rotation === 90
      ? [0, scale, scale, 0, -r.y * scale, -r.x * scale]
      : rotation === 180
        ? [-scale, 0, 0, scale, (r.x + r.width) * scale, -r.y * scale]
        : rotation === 270
          ? [
              0,
              -scale,
              -scale,
              0,
              (r.y + r.height) * scale,
              (r.x + r.width) * scale,
            ]
          : [scale, 0, 0, -scale, -r.x * scale, (r.y + r.height) * scale];
  await view.flush();
  const page = view.native.loadPage(
    resolveNativePage(view, document, pageIndex),
  );
  try {
    const bitmap = page.render(matrix, [0, 0, width, height], {
      contents: false,
      annotations: false,
      keepAnnotations: new Set([view.actual(ref.objectNumber)]),
      transparent: true,
    });
    try {
      return pngDataUrl(bitmap.asPNG());
    } finally {
      bitmap.destroy();
    }
  } finally {
    page.destroy();
  }
}

/** Render arbitrary standard Form-XObject icons without a browser canvas or a second PDF document.
 * The temporary stamp is removed in finally; the original widget and icon are never rewritten. */
export async function renderButtonIcon(
  document: PDFDocument,
  pageIndex: number,
  icon: PDFStream,
): Promise<string | undefined> {
  const view = getEditingView(document);
  if (!view) return undefined;
  const bounds = getButtonIconBounds(icon);
  const page = document.getPage(pageIndex);
  const hadAnnots = page.node.has(PDFName.of("Annots"));
  const iconRef =
    document.context.getObjectRef(icon) ?? document.context.register(icon);
  const dict = document.context.obj({
    Type: "Annot",
    Subtype: "Stamp",
    F: 4,
    Rect: [0, 0, bounds.width, bounds.height],
    AP: { N: iconRef },
    P: page.ref,
  });
  const ref = document.context.register(dict);
  page.node.addAnnot(ref);
  try {
    return await renderWidgetAppearance(
      document,
      pageIndex,
      PDFWidgetAnnotation.fromDict(dict),
      ref,
    );
  } finally {
    page.node.removeAnnot(ref);
    if (!hadAnnots) page.node.delete(PDFName.of("Annots"));
    document.context.delete(ref);
    await view.flush();
  }
}
