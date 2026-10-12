import {
  PDFArray,
  PDFContext,
  PDFDict,
  PDFObject,
  PDFRef,
  PDFStream,
  PDFString,
  PDFHexString,
} from "@cantoo/pdf-lib";

/** Copy a page-content graph with explicit reference tracking. A second pass
 * can reuse original images, fonts and optional-content groups that MuPDF did
 * not change, including resources nested inside a rewritten Form XObject. */
export class ContentResourceCopier {
  readonly references = new Map<PDFRef, PDFRef>();
  private readonly objects = new Map<PDFObject, PDFObject>();

  constructor(
    private readonly source: PDFContext,
    private readonly target: PDFContext,
    reuse?: Map<PDFRef, PDFRef>,
  ) {
    for (const [from, to] of reuse ?? []) this.references.set(from, to);
  }

  copy<T extends PDFObject>(object: T): T {
    if (object instanceof PDFRef) {
      const previous = this.references.get(object);
      if (previous) return previous as unknown as T;
      const ref = this.target.nextRef();
      this.references.set(object, ref);
      const value = this.source.lookup(object);
      if (!value) throw new Error("PDF content contains a missing resource.");
      this.target.assign(ref, this.copy(value));
      return ref as unknown as T;
    }
    const previous = this.objects.get(object);
    if (previous) return previous as T;
    const clone = object.clone(this.target);
    this.objects.set(object, clone);
    if (object instanceof PDFStream && clone instanceof PDFStream) {
      for (const [key, value] of object.dict.entries())
        clone.dict.set(key, this.copy(value));
    } else if (object instanceof PDFDict && clone instanceof PDFDict) {
      for (const [key, value] of object.entries())
        clone.set(key, this.copy(value));
    } else if (object instanceof PDFArray && clone instanceof PDFArray) {
      for (let i = 0; i < object.size(); i++)
        clone.set(i, this.copy(object.get(i)));
    }
    return clone as T;
  }
}

const sameObject = (
  before: PDFObject | undefined,
  after: PDFObject | undefined,
): boolean => {
  if (!before || !after) return false;
  if (
    (before instanceof PDFString || before instanceof PDFHexString) &&
    (after instanceof PDFString || after instanceof PDFHexString)
  ) {
    const a = before.asBytes(),
      b = after.asBytes();
    return a.length === b.length && a.every((byte, index) => byte === b[index]);
  }
  if (before instanceof PDFStream && after instanceof PDFStream) {
    const a = before.getContents(),
      b = after.getContents();
    return (
      a.length === b.length &&
      a.every((byte, i) => byte === b[i]) &&
      sameObject(before.dict, after.dict)
    );
  }
  if (before instanceof PDFDict && after instanceof PDFDict) {
    const entries = before.entries();
    return (
      entries.length === after.entries().length &&
      entries.every(([key, value]) => sameObject(value, after.get(key)))
    );
  }
  if (before instanceof PDFArray && after instanceof PDFArray)
    return (
      before.size() === after.size() &&
      Array.from({ length: before.size() }, (_, i) =>
        sameObject(before.get(i), after.get(i)),
      ).every(Boolean)
    );
  return (
    before.constructor === after.constructor &&
    before.toString() === after.toString()
  );
};

const referencesIn = (
  object: PDFObject | undefined,
  result = new Set<PDFRef>(),
): Set<PDFRef> => {
  if (object instanceof PDFRef) result.add(object);
  else if (object instanceof PDFStream) referencesIn(object.dict, result);
  else if (object instanceof PDFDict) {
    for (const [, value] of object.entries()) referencesIn(value, result);
  } else if (object instanceof PDFArray) {
    for (let i = 0; i < object.size(); i++) referencesIn(object.get(i), result);
  }
  return result;
};

/** MuPDF's garbage=1 removes unused objects without renumbering them. Reuse is
 * permitted only when the object AND all its referenced descendants match. */
export const unchangedContentResources = (
  staged: PDFContext,
  rewritten: PDFContext,
  originalToStaged: Map<PDFRef, PDFRef>,
) => {
  const reusable = new Map<PDFRef, PDFRef>();
  const dependencies = new Map<PDFRef, Set<PDFRef>>();
  for (const [originalRef, stagedRef] of originalToStaged) {
    const before = staged.lookup(stagedRef);
    if (!sameObject(before, rewritten.lookup(stagedRef))) continue;
    reusable.set(stagedRef, originalRef);
    dependencies.set(stagedRef, referencesIn(before));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [ref, children] of dependencies) {
      if (
        reusable.has(ref) &&
        [...children].some((child) => !reusable.has(child))
      ) {
        reusable.delete(ref);
        changed = true;
      }
    }
  }
  return reusable;
};
