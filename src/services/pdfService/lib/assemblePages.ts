import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFObjectCopier,
  PDFPage,
  PDFPageLeaf,
  PDFRef,
  PDFString,
  PDFHexString,
  PDFRadioGroup,
  degrees,
  PDFObject,
} from "@cantoo/pdf-lib";
import type {
  Annotation,
  FormField,
  PageData,
  PageSource,
  PreservedSourceAnnotationRef,
} from "@/types";
import { lookupInFieldChain } from "./pdf-import-utils";
import {
  readNamedPageDestinations,
  resolvePageDestination,
} from "./pageDestinations";

type SourceRef = { objectNumber: number; generationNumber: number };
const refKey = (ref: SourceRef) =>
  `${ref.objectNumber}:${ref.generationNumber}`;
const asSourceRef = (ref: PDFRef): SourceRef => ({
  objectNumber: ref.objectNumber,
  generationNumber: ref.generationNumber,
});
const fieldKeys = [
  "FT",
  "Ff",
  "V",
  "DV",
  "DA",
  "Q",
  "Opt",
  "MaxLen",
  "TU",
  "TM",
  "AA",
  "DS",
  "RV",
];

/** Assemble once at export time; live edits retain immutable source bytes. */
export async function assemblePages(
  doc: PDFDocument,
  originalBytes: Uint8Array,
  openPassword: string | undefined,
  structure: { pages: PageData[]; sources: Record<string, PageSource> },
  controls: {
    fields: FormField[];
    annotations: Annotation[];
    preserved: PreservedSourceAnnotationRef[];
  },
) {
  const originalPages = doc.getPages();
  const sources = new Map<string, PDFDocument>();
  const getSource = async (id: string) => {
    let source = sources.get(id);
    if (!source) {
      const data = structure.sources[id];
      if (id !== "default" && !data) throw new Error("Missing PDF page source");
      source = await PDFDocument.load(
        id === "default" ? originalBytes : data.bytes,
        {
          password:
            id === "default" ? (openPassword ?? "") : (data.password ?? ""),
        },
      );
      sources.set(id, source);
    }
    return source;
  };
  type Group = {
    copier: PDFObjectCopier;
    source: PDFDocument;
    sourceId: string;
    pages: Map<number, PDFPage>;
    outputIndexes: Set<number>;
    sourceAnnotKeys: Set<string>;
    destinations: Map<string, PDFObject>;
    links: Array<{ dict: PDFDict; destination: PDFObject; action?: PDFDict }>;
    pageIndexes: Map<string, number>;
  };
  const groups = new Map<string, Group>();
  const groupByIndex = new Map<number, Group>();
  const result: PDFPage[] = [];
  for (const [index, page] of structure.pages.entries()) {
    if (page.blank) {
      const blank = PDFPage.create(doc);
      blank.setSize(page.width, page.height);
      result.push(blank);
      continue;
    }
    const origin = page.source ?? {
      documentId: "default",
      pageIndex: page.pageIndex,
    };
    if (origin.documentId === "default" && !origin.copyGroup) {
      const original = originalPages[origin.pageIndex];
      if (!original) throw new Error("Invalid original page index");
      result.push(original);
      continue;
    }
    const groupKey = `${origin.documentId}/${origin.copyGroup ?? "import"}`;
    let group = groups.get(groupKey);
    if (!group) {
      const source = await getSource(origin.documentId);
      group = {
        source,
        sourceId: origin.documentId,
        copier: PDFObjectCopier.for(source.context, doc.context),
        pages: new Map(),
        outputIndexes: new Set(),
        sourceAnnotKeys: new Set(),
        destinations: readNamedPageDestinations(source),
        links: [],
        pageIndexes: new Map(
          source.getPages().map((p, i) => [p.ref.toString(), i]),
        ),
      };
      groups.set(groupKey, group);
    }
    const donor = group.source.getPages()[origin.pageIndex];
    if (!donor) throw new Error("Invalid imported page index");
    // Copy page content without following widget parents or internal links into
    // unselected pages. Reconnect fields and destinations after all pages exist.
    const detached: Array<[PDFDict, PDFName, PDFObject]> = [];
    const links: Array<{
      source: PDFDict;
      destination: PDFObject;
      action?: PDFDict;
    }> = [];
    const detach = (dict: PDFDict, key: string) => {
      const name = PDFName.of(key);
      const value = dict.get(name);
      if (value) {
        detached.push([dict, name, value]);
        dict.delete(name);
      }
      return value;
    };
    const donorAnnots = donor.node.Annots();
    if (donorAnnots)
      for (let a = 0; a < donorAnnots.size(); a++) {
        const annotRef = donorAnnots.get(a);
        if (annotRef instanceof PDFRef)
          group.sourceAnnotKeys.add(refKey(annotRef));
        const dict = group.source.context.lookup(annotRef);
        if (!(dict instanceof PDFDict)) continue;
        if (dict.get(PDFName.of("Subtype")) === PDFName.of("Widget"))
          detach(dict, "Parent");
        const destination = detach(dict, "Dest");
        if (destination) links.push({ source: dict, destination });
        const action = dict.lookupMaybe(PDFName.of("A"), PDFDict);
        if (action?.get(PDFName.of("S")) === PDFName.of("GoTo")) {
          detach(dict, "A");
          const destination = action.get(PDFName.of("D"));
          if (destination) links.push({ source: dict, destination, action });
        }
      }
    let ref: PDFRef;
    try {
      ref = group.copier.copy(donor.ref);
      for (const link of links)
        group.links.push({ ...link, dict: group.copier.copy(link.source) });
    } finally {
      for (const [dict, name, value] of detached) dict.set(name, value);
    }
    const leaf = doc.context.lookup(ref);
    if (!(leaf instanceof PDFPageLeaf)) throw new Error("Invalid copied page");
    const copied = PDFPage.of(leaf, ref, doc);
    group.pages.set(origin.pageIndex, copied);
    group.outputIndexes.add(index);
    groupByIndex.set(index, group);
    result.push(copied);
  }
  // Original page objects keep their refs, so retained bookmarks still point at
  // the same page after reordering. Copies have their own object graph.
  for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
  for (const page of result) doc.addPage(page);

  const mapRef = (pageIndex: number, ref: SourceRef | undefined) => {
    const group = groupByIndex.get(pageIndex);
    return ref && group
      ? asSourceRef(
          group.copier.copy(PDFRef.of(ref.objectNumber, ref.generationNumber)),
        )
      : ref;
  };
  const fields = controls.fields.map((field) => ({
    ...field,
    sourcePdfRef: mapRef(field.pageIndex, field.sourcePdfRef),
  }));
  const annotations = controls.annotations.map((annotation) => ({
    ...annotation,
    sourcePdfRef: mapRef(annotation.pageIndex, annotation.sourcePdfRef),
    replies: annotation.replies?.map((reply) => ({
      ...reply,
      sourcePdfRef: mapRef(annotation.pageIndex, reply.sourcePdfRef),
    })),
  }));
  const preserved = controls.preserved.map((annotation) => ({
    ...annotation,
    sourcePdfRef: mapRef(annotation.pageIndex, annotation.sourcePdfRef)!,
  }));

  const form = doc.getForm();
  const rootFields = form.acroForm.normalizedEntries().Fields;
  const usedNames = new Set(form.getFields().map((field) => field.getName()));
  let fontSeq = 0;
  for (const group of groups.values()) {
    const sourceForm = group.source.getForm();
    const copiedWidgets = new Set<string>();
    for (const index of group.outputIndexes) {
      const annots = result[index].node.Annots();
      if (annots)
        for (let i = 0; i < annots.size(); i++) {
          const ref = annots.get(i);
          if (ref instanceof PDFRef) copiedWidgets.add(refKey(ref));
        }
    }
    // /DA uses AcroForm resource names. Namespace imported fonts so two PDFs
    // may both use /F1 without changing either field's font.
    const fontNames = new Map<string, string>();
    const sourceDr = sourceForm.acroForm.dict.lookupMaybe(
      PDFName.of("DR"),
      PDFDict,
    );
    const sourceFonts = sourceDr?.lookupMaybe(PDFName.of("Font"), PDFDict);
    if (sourceFonts) {
      let dr = form.acroForm.dict.lookupMaybe(PDFName.of("DR"), PDFDict);
      if (!dr) {
        dr = doc.context.obj({});
        form.acroForm.dict.set(PDFName.of("DR"), dr);
      }
      let fonts = dr.lookupMaybe(PDFName.of("Font"), PDFDict);
      if (!fonts) {
        fonts = doc.context.obj({});
        dr.set(PDFName.of("Font"), fonts);
      }
      for (const [name, resource] of sourceFonts.entries()) {
        let renamed: string;
        do {
          renamed = `LegirPageFont${fontSeq++}`;
        } while (fonts.has(PDFName.of(renamed)));
        fonts.set(PDFName.of(renamed), group.copier.copy(resource));
        fontNames.set(name.decodeText(), renamed);
      }
    }
    for (const sourceField of sourceForm.getFields()) {
      const widgets = sourceField.acroField.getWidgets();
      const kids = sourceField.acroField.Kids();
      const selected = widgets.flatMap((widget, index) => {
        const sourceRef = kids ? kids.get(index) : sourceField.ref;
        if (
          !(sourceRef instanceof PDFRef) ||
          !group.sourceAnnotKeys.has(refKey(sourceRef))
        )
          return [];
        const copiedRef = group.copier.copy(sourceRef);
        return copiedWidgets.has(refKey(copiedRef))
          ? [{ sourceRef, copiedRef, widget, index }]
          : [];
      });
      if (!selected.length) continue;
      const editorField = fields.find(
        (field) =>
          group.outputIndexes.has(field.pageIndex) &&
          field.sourcePdfRef &&
          selected.some(
            (widget) =>
              refKey(widget.copiedRef) === refKey(field.sourcePdfRef!),
          ),
      );
      let name = editorField?.name ?? sourceField.getName();
      if (!editorField) {
        const base = name;
        for (let suffix = 2; usedNames.has(name); suffix++)
          name = `${base}_${suffix}`;
      }
      usedNames.add(name);
      const root = doc.context.obj({ T: PDFString.of(name) });
      for (const key of fieldKeys) {
        const value =
          lookupInFieldChain(sourceField.acroField.dict, key) ??
          (key === "DA"
            ? sourceForm.acroForm.dict.get(PDFName.of("DA"))
            : undefined);
        if (value instanceof PDFObject)
          root.set(PDFName.of(key), group.copier.copy(value));
      }
      const da = root.get(PDFName.of("DA"));
      if (da instanceof PDFString || da instanceof PDFHexString)
        root.set(
          PDFName.of("DA"),
          PDFString.of(
            da
              .decodeText()
              .replace(/\/([^\s/]+)(?=\s)/g, (match, font: string) =>
                fontNames.has(font) ? `/${fontNames.get(font)}` : match,
              ),
          ),
        );
      const opt = root.lookupMaybe(PDFName.of("Opt"), PDFArray);
      const isRadio = sourceField instanceof PDFRadioGroup;
      if (isRadio && opt)
        root.set(
          PDFName.of("Opt"),
          doc.context.obj(selected.map(({ index }) => opt.get(index))),
        );
      if (isRadio) {
        for (const key of ["V", "DV"]) {
          const value = root.get(PDFName.of(key));
          if (
            value &&
            !selected.some(({ widget }) => widget.getOnValue() === value)
          )
            root.set(PDFName.of(key), PDFName.of("Off"));
        }
      }
      const rootRef = doc.context.register(root);
      root.set(
        PDFName.of("Kids"),
        doc.context.obj(selected.map(({ copiedRef }) => copiedRef)),
      );
      for (const { copiedRef } of selected) {
        const widget = doc.context.lookup(copiedRef, PDFDict);
        for (const key of [...fieldKeys, "T", "Kids"])
          widget.delete(PDFName.of(key));
        widget.set(PDFName.of("Parent"), rootRef);
      }
      rootFields.push(rootRef);
    }
  }

  const retainedRefs = new Set(result.map((page) => page.ref.toString()));
  for (const group of groups.values())
    for (const link of group.links) {
      const sourceDest = resolvePageDestination(
        group.source,
        link.destination,
        group.destinations,
      );
      const sourceRef = sourceDest?.get(0);
      const sourceIndex =
        sourceRef instanceof PDFRef
          ? group.pageIndexes.get(sourceRef.toString())
          : undefined;
      if (sourceIndex === undefined || !sourceDest) continue;
      const target =
        group.pages.get(sourceIndex) ??
        (group.sourceId === "default" ? originalPages[sourceIndex] : undefined);
      if (!target || !retainedRefs.has(target.ref.toString())) continue;
      const destination = doc.context.obj([
        target.ref,
        ...sourceDest
          .asArray()
          .slice(1)
          .map((item) => group.copier.copy(item)),
      ]);
      if (link.action) {
        const action = doc.context.obj({});
        for (const [key, value] of link.action.entries())
          if (key !== PDFName.of("D"))
            action.set(key, group.copier.copy(value));
        action.set(PDFName.of("D"), destination);
        link.dict.set(PDFName.of("A"), action);
      } else link.dict.set(PDFName.of("Dest"), destination);
    }
  // Retained original links and outlines keep their targets after a reorder.
  // Resolve names to explicit arrays and discard targets deleted from the tree.
  const destinations = readNamedPageDestinations(doc);
  const fixDestination = (
    dest: PDFObject | undefined,
  ): PDFArray | undefined => {
    const resolved = resolvePageDestination(doc, dest, destinations);
    const ref = resolved?.get(0);
    return ref instanceof PDFRef && retainedRefs.has(ref.toString())
      ? resolved
      : undefined;
  };
  const fixLink = (dict: PDFDict) => {
    const dest = dict.get(PDFName.of("Dest"));
    if (dest) {
      const resolved = fixDestination(dest);
      if (resolved) dict.set(PDFName.of("Dest"), resolved);
      else dict.delete(PDFName.of("Dest"));
    }
    const action = dict.lookupMaybe(PDFName.of("A"), PDFDict);
    if (action?.get(PDFName.of("S")) === PDFName.of("GoTo")) {
      const resolved = fixDestination(action.get(PDFName.of("D")));
      if (resolved) action.set(PDFName.of("D"), resolved);
      else dict.delete(PDFName.of("A"));
    }
  };
  for (const page of result) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const dict = doc.context.lookup(annots.get(i));
      if (dict instanceof PDFDict) {
        dict.set(PDFName.of("P"), page.ref);
        fixLink(dict);
      }
    }
  }
  const visited = new Set<PDFDict>();
  const visitOutline = (dict: PDFDict | undefined) => {
    if (!dict || visited.has(dict)) return;
    visited.add(dict);
    fixLink(dict);
    visitOutline(dict.lookupMaybe(PDFName.of("First"), PDFDict));
    visitOutline(dict.lookupMaybe(PDFName.of("Next"), PDFDict));
  };
  visitOutline(doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict));

  return {
    fields,
    annotations,
    preserved,
    applyRotation: () =>
      structure.pages.forEach((page, index) => {
        if (page.rotationDelta)
          result[index].setRotation(
            degrees(
              (result[index].getRotation().angle + page.rotationDelta) % 360,
            ),
          );
      }),
  };
}
