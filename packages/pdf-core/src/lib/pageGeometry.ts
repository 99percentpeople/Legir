import type { PageData } from "@legir/pdf-model";
import {
  assertPageGeometry,
  sourceRectToPdfBox,
} from "@legir/pdf-model/pageGeometry";
import {
  PDFName,
  PDFNumber,
  PDFArray,
  PDFDict,
  PDFStream,
  PDFRawStream,
  PDFString,
  PDFHexString,
  PDFRef,
  type PDFObject,
  type PDFDocument,
} from "@legir/pdfium/authoring";
import {
  readNamedPageDestinations,
  resolvePageDestination,
} from "./pageDestinations.js";

/** Finish in PDF coordinates, after controls have been exported in the source
 * viewport. Materialize resize scaling instead of relying on readers to interpret a new
 * UserUnit value. Retain the source document's existing coordinate unit. */
export function applyPageGeometry(document: PDFDocument, pages: PageData[]) {
  if (!pages.some((page) => page.geometry)) return;
  const output = document.getPages();
  const scales = new Map<string, number>();
  const scaledAnnotations = new Set<PDFDict>();
  const scaledAppearances = new Map<PDFStream, Map<number, PDFRef>>();
  const scaleArray = (array: PDFArray, scale: number): PDFArray =>
    document.context.obj(
      array.asArray().map((item) => {
        const value = document.context.lookup(item);
        return value instanceof PDFNumber
          ? PDFNumber.of(value.asNumber() * scale)
          : value instanceof PDFArray
            ? scaleArray(value, scale)
            : item;
      }),
    );
  const scaleEntry = (dict: PDFDict, key: string, scale: number) => {
    const value = dict.lookup(PDFName.of(key));
    if (value instanceof PDFArray)
      dict.set(PDFName.of(key), scaleArray(value, scale));
    else if (value instanceof PDFNumber)
      dict.set(PDFName.of(key), PDFNumber.of(value.asNumber() * scale));
  };
  const appearance = (stream: PDFStream, scale: number): PDFRef => {
    let cache = scaledAppearances.get(stream);
    if (!cache) {
      cache = new Map();
      scaledAppearances.set(stream, cache);
    }
    const cached = cache.get(scale);
    if (cached) return cached;
    const dict = stream.dict.clone();
    dict.set(PDFName.of("Matrix"), document.context.obj([1, 0, 0, 1, 0, 0]));
    const original = document.context.register(
      PDFRawStream.of(dict, stream.getContents()),
    );
    const bbox =
      stream.dict.lookupMaybe(PDFName.of("BBox"), PDFArray) ??
      document.context.obj([0, 0, 1, 1]);
    const m = stream.dict
      .lookupMaybe(PDFName.of("Matrix"), PDFArray)
      ?.asArray()
      .map((n) => (document.context.lookup(n) as PDFNumber).asNumber()) ?? [
      1, 0, 0, 1, 0, 0,
    ];
    // Keep appearance rotation. Its local space and translation grow together;
    // the nested original retains every font, image, transparency and vector.
    const wrapper = document.context.stream(
      `q\n${scale} 0 0 ${scale} 0 0 cm\n/Original Do\nQ\n`,
      {
        Type: "XObject",
        Subtype: "Form",
        BBox: scaleArray(bbox, scale),
        Matrix: [m[0], m[1], m[2], m[3], m[4] * scale, m[5] * scale],
        Resources: { XObject: { Original: original } },
      },
    );
    const ref = document.context.register(wrapper);
    cache.set(scale, ref);
    return ref;
  };
  const appearanceEntry = (value: PDFObject, scale: number): PDFObject => {
    const resolved = document.context.lookup(value);
    if (resolved instanceof PDFStream) return appearance(resolved, scale);
    if (resolved instanceof PDFDict) {
      const next = resolved.clone();
      for (const [key, item] of resolved.entries())
        next.set(key, appearanceEntry(item, scale));
      return next;
    }
    return value;
  };
  const inheritedAppearance = (dict: PDFDict) => {
    const visited = new Set<PDFDict>();
    let node: PDFDict | undefined = dict;
    while (node && !visited.has(node)) {
      visited.add(node);
      const da = node.lookup(PDFName.of("DA"));
      if (da instanceof PDFString || da instanceof PDFHexString)
        return da.decodeText();
      node = node.lookupMaybe(PDFName.of("Parent"), PDFDict);
    }
    const da = document.catalog
      .lookupMaybe(PDFName.of("AcroForm"), PDFDict)
      ?.lookup(PDFName.of("DA"));
    return da instanceof PDFString || da instanceof PDFHexString
      ? da.decodeText()
      : undefined;
  };
  const scaleAnnotation = (dict: PDFDict, scale: number) => {
    if (scaledAnnotations.has(dict)) return;
    scaledAnnotations.add(dict);
    for (const key of [
      "Rect",
      "QuadPoints",
      "L",
      "Vertices",
      "InkList",
      "CL",
      "RD",
      "Border",
      "Path",
    ])
      scaleEntry(dict, key, scale);
    const bs = dict.lookupMaybe(PDFName.of("BS"), PDFDict);
    if (bs) {
      const next = bs.clone();
      scaleEntry(next, "W", scale);
      scaleEntry(next, "D", scale);
      dict.set(PDFName.of("BS"), next);
    }
    const subtype = dict.get(PDFName.of("Subtype"));
    const da =
      subtype === PDFName.of("Widget") || subtype === PDFName.of("FreeText")
        ? inheritedAppearance(dict)
        : undefined;
    if (da)
      dict.set(
        PDFName.of("DA"),
        PDFString.of(
          da.replace(
            /([-+]?\d*\.?\d+)\s+(Tf|TL|Tc|Tw|Ts)\b/g,
            (_all, n: string, op: string) => `${Number(n) * scale} ${op}`,
          ),
        ),
      );
    const ap = dict.get(PDFName.of("AP"));
    if (ap) dict.set(PDFName.of("AP"), appearanceEntry(ap, scale));
    const popup = dict.lookupMaybe(PDFName.of("Popup"), PDFDict);
    if (popup) scaleAnnotation(popup, scale);
  };
  pages.forEach((source, index) => {
    if (!source.geometry) return;
    assertPageGeometry(source, source.geometry);
    const page = output[index];
    if (!page) throw new Error("Missing output page");
    const scale = source.geometry.scale;
    const media = source.geometry.mediaBox
      ? sourceRectToPdfBox(source, source.geometry.mediaBox)
      : page.node
          .MediaBox()
          .asArray()
          .map((n) => (document.context.lookup(n) as PDFNumber).asNumber());
    const crop = sourceRectToPdfBox(source, source.geometry.box);
    page.node.set(
      PDFName.of("MediaBox"),
      document.context.obj(media.map((n) => n * scale)),
    );
    page.node.set(
      PDFName.of("CropBox"),
      document.context.obj(crop.map((n) => n * scale)),
    );
    page.node.set(PDFName.of("UserUnit"), PDFNumber.of(source.userUnit));
    for (const key of ["TrimBox", "BleedBox", "ArtBox"]) {
      const box = page.node.lookupMaybe(PDFName.of(key), PDFArray);
      if (!box || box.size() !== 4) continue;
      const values = box
        .asArray()
        .map((n) => (document.context.lookup(n) as PDFNumber).asNumber());
      const clipped = [
        Math.max(values[0], media[0]),
        Math.max(values[1], media[1]),
        Math.min(values[2], media[2]),
        Math.min(values[3], media[3]),
      ];
      if (clipped[2] > clipped[0] && clipped[3] > clipped[1]) {
        page.node.set(
          PDFName.of(key),
          document.context.obj(clipped.map((n) => n * scale)),
        );
      } else {
        page.node.delete(PDFName.of(key));
      }
    }
    if (Math.abs(scale - 1) < 1e-12) return;
    scales.set(page.ref.toString(), scale);
    const contents = page.node.normalizedEntries().Contents;
    contents.insert(
      0,
      document.context.register(
        document.context.stream(`q\n${scale} 0 0 ${scale} 0 0 cm\n`),
      ),
    );
    contents.push(document.context.register(document.context.stream("\nQ\n")));
    const annots = page.node.Annots();
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const annot = annots!.lookup(i);
      if (annot instanceof PDFDict) scaleAnnotation(annot, scale);
    }
  });
  if (!scales.size) return;
  // Destination coordinates belong to the target page, not the link's page.
  const names = readNamedPageDestinations(document),
    visitedDestinations = new Set<PDFArray>();
  const destination = (value: PDFObject | undefined) => {
    const array = resolvePageDestination(document, value, names);
    if (!array || visitedDestinations.has(array)) return;
    visitedDestinations.add(array);
    const ref = array.get(0),
      mode = array.lookup(1);
    const scale =
      ref instanceof PDFRef ? scales.get(ref.toString()) : undefined;
    if (!scale || !(mode instanceof PDFName)) return;
    const indices: Record<string, number[]> = {
      XYZ: [2, 3],
      FitH: [2],
      FitBH: [2],
      FitV: [2],
      FitBV: [2],
      FitR: [2, 3, 4, 5],
    };
    for (const index of indices[mode.decodeText()] ?? []) {
      const v = array.lookup(index);
      if (v instanceof PDFNumber)
        array.set(index, PDFNumber.of(v.asNumber() * scale));
    }
  };
  const fixLink = (dict: PDFDict) => {
    destination(dict.get(PDFName.of("Dest")));
    const action = dict.lookupMaybe(PDFName.of("A"), PDFDict);
    if (action?.get(PDFName.of("S")) === PDFName.of("GoTo"))
      destination(action.get(PDFName.of("D")));
  };
  for (const value of names.values()) destination(value);
  const openAction = document.catalog.lookup(PDFName.of("OpenAction"));
  if (openAction instanceof PDFArray) destination(openAction);
  else if (
    openAction instanceof PDFDict &&
    openAction.get(PDFName.of("S")) === PDFName.of("GoTo")
  )
    destination(openAction.get(PDFName.of("D")));
  for (const page of output) {
    const annots = page.node.Annots();
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const dict = annots!.lookup(i);
      if (dict instanceof PDFDict) fixLink(dict);
    }
  }
  const visited = new Set<PDFDict>();
  const outline = (dict: PDFDict | undefined) => {
    if (!dict || visited.has(dict)) return;
    visited.add(dict);
    fixLink(dict);
    outline(dict.lookupMaybe(PDFName.of("First"), PDFDict));
    outline(dict.lookupMaybe(PDFName.of("Next"), PDFDict));
  };
  outline(document.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict));
}
