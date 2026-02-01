import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  type PDFObject,
  type PDFPage,
  PDFRef,
  PDFStream,
} from "@cantoo/pdf-lib";
import type { Annotation } from "@/types";
import type { ViewportLike } from "../types";
import { uiRectToPdfBounds } from "./coords";
import {
  decodePdfStreamToText,
  extractPdfStreamFilters,
} from "./pdf-import-utils";

type Matrix = [number, number, number, number, number, number];

type PdfRect = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

type NumberToken = { t: "number"; v: number; raw: string };
type NameToken = { t: "name"; v: string };
type StringToken = { t: "string"; raw: string };
type HexToken = { t: "hex"; raw: string };
type ArrayToken = { t: "array"; raw: string };
type DictToken = { t: "dict"; raw: string };
type WordToken = { t: "word"; v: string };

type Token =
  | NumberToken
  | NameToken
  | StringToken
  | HexToken
  | ArrayToken
  | DictToken
  | WordToken;

type Op = { op: string; args: Token[] };

const identityMatrix = (): Matrix => [1, 0, 0, 1, 0, 0];

const mul = (m1: Matrix, m2: Matrix): Matrix => {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
};

const apply = (m: Matrix, p: [number, number]): [number, number] => {
  const [x, y] = p;
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
};

const intersects = (a: PdfRect, b: PdfRect) => {
  return !(a.x1 <= b.x0 || a.x0 >= b.x1 || a.y1 <= b.y0 || a.y0 >= b.y1);
};

const hasDecompressionStream = () => {
  const g = globalThis as unknown as { DecompressionStream?: unknown };
  return typeof g.DecompressionStream !== "undefined";
};

const trimSlash = (s: string) => s.replace(/^\//, "");

const tokenToString = (t: Token): string => {
  if (t.t === "number") return t.raw;
  if (t.t === "name") return `/${t.v}`;
  if (t.t === "word") return t.v;
  return t.raw;
};

const encodeOps = (ops: Op[]): string => {
  return ops
    .map((o) => {
      const args = o.args.map(tokenToString);
      return `${args.length > 0 ? `${args.join(" ")} ` : ""}${o.op}`;
    })
    .join("\n");
};

const isOperandWord = (w: string) =>
  w === "true" || w === "false" || w === "null";

const readWhile = (s: string, i: number, pred: (ch: string) => boolean) => {
  let j = i;
  while (j < s.length && pred(s[j]!)) j++;
  return j;
};

const skipWsAndComments = (s: string, start: number) => {
  let i = start;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "%") {
      i = readWhile(s, i, (c) => c !== "\n" && c !== "\r");
      continue;
    }
    if (
      ch === " " ||
      ch === "\t" ||
      ch === "\n" ||
      ch === "\r" ||
      ch === "\f" ||
      ch === "\0"
    ) {
      i++;
      continue;
    }
    break;
  }
  return i;
};

const readName = (s: string, i: number) => {
  const j = readWhile(
    s,
    i + 1,
    (c) =>
      !(
        c === " " ||
        c === "\t" ||
        c === "\n" ||
        c === "\r" ||
        c === "\f" ||
        c === "\0" ||
        c === "/" ||
        c === "[" ||
        c === "]" ||
        c === "(" ||
        c === ")" ||
        c === "<" ||
        c === ">"
      ),
  );
  const tok: NameToken = { t: "name", v: s.slice(i + 1, j) };
  return { tok, next: j };
};

const readNumber = (s: string, i: number) => {
  const j = readWhile(s, i, (c) => /[0-9+.-]/.test(c));
  const raw = s.slice(i, j);
  const v = Number(raw);
  const tok: NumberToken = { t: "number", v, raw };
  return { tok, next: j };
};

const readWord = (s: string, i: number) => {
  const j = readWhile(
    s,
    i,
    (c) =>
      !(
        c === " " ||
        c === "\t" ||
        c === "\n" ||
        c === "\r" ||
        c === "\f" ||
        c === "\0" ||
        c === "[" ||
        c === "]" ||
        c === "(" ||
        c === ")" ||
        c === "<" ||
        c === ">" ||
        c === "/"
      ),
  );
  const w = s.slice(i, j);
  const tok: WordToken = { t: "word", v: w };
  return { tok, next: j };
};

const readLiteralString = (s: string, i: number) => {
  let j = i + 1;
  let depth = 1;
  while (j < s.length && depth > 0) {
    const ch = s[j]!;
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    j++;
  }
  const raw = s.slice(i, Math.min(j, s.length));
  const tok: StringToken = { t: "string", raw };
  return { tok, next: Math.min(j, s.length) };
};

const readHexString = (s: string, i: number) => {
  const j = s.indexOf(">", i + 1);
  const end = j === -1 ? s.length : j + 1;
  const tok: HexToken = { t: "hex", raw: s.slice(i, end) };
  return { tok, next: end };
};

const readArrayRaw = (s: string, i: number) => {
  let j = i + 1;
  let depth = 1;
  while (j < s.length && depth > 0) {
    const ch = s[j]!;

    if (ch === "%") {
      j = readWhile(s, j, (c) => c !== "\n" && c !== "\r");
      continue;
    }

    if (ch === "\\") {
      j += 2;
      continue;
    }

    if (ch === "(") {
      const r = readLiteralString(s, j);
      j = r.next;
      continue;
    }

    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    j++;
  }
  const raw = s.slice(i, Math.min(j, s.length));
  const tok: ArrayToken = { t: "array", raw };
  return { tok, next: Math.min(j, s.length) };
};

const readDictRaw = (s: string, i: number) => {
  let j = i + 2;
  let depth = 1;
  while (j < s.length && depth > 0) {
    const ch = s[j]!;

    if (ch === "%") {
      j = readWhile(s, j, (c) => c !== "\n" && c !== "\r");
      continue;
    }

    if (ch === "\\") {
      j += 2;
      continue;
    }

    if (ch === "(") {
      const r = readLiteralString(s, j);
      j = r.next;
      continue;
    }

    if (ch === "[") {
      const r = readArrayRaw(s, j);
      j = r.next;
      continue;
    }

    if (ch === "<" && s[j + 1] !== "<") {
      const r = readHexString(s, j);
      j = r.next;
      continue;
    }

    if (ch === "<" && s[j + 1] === "<") {
      depth++;
      j += 2;
      continue;
    }

    if (ch === ">" && s[j + 1] === ">") {
      depth--;
      j += 2;
      continue;
    }

    j++;
  }

  const raw = s.slice(i, Math.min(j, s.length));
  const tok: DictToken = { t: "dict", raw };
  return { tok, next: Math.min(j, s.length) };
};

const tokenize = (s: string): Token[] => {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    i = skipWsAndComments(s, i);
    if (i >= s.length) break;
    const ch = s[i]!;

    if (ch === "/") {
      const r = readName(s, i);
      out.push(r.tok);
      i = r.next;
      continue;
    }

    if (ch === "(") {
      const r = readLiteralString(s, i);
      out.push(r.tok);
      i = r.next;
      continue;
    }

    if (ch === "[") {
      const r = readArrayRaw(s, i);
      out.push(r.tok);
      i = r.next;
      continue;
    }

    if (ch === "<" && s[i + 1] === "<") {
      const r = readDictRaw(s, i);
      out.push(r.tok);
      i = r.next;
      continue;
    }

    if (ch === "<" && s[i + 1] !== "<") {
      const r = readHexString(s, i);
      out.push(r.tok);
      i = r.next;
      continue;
    }

    if (/[0-9+.-]/.test(ch)) {
      const r = readNumber(s, i);
      if (Number.isFinite(r.tok.v)) {
        out.push(r.tok);
        i = r.next;
        continue;
      }
    }

    const r = readWord(s, i);
    if (r.next <= i || r.tok.v === "") {
      i += 1;
      continue;
    }
    out.push(r.tok);
    i = r.next;
  }
  return out;
};

const parseOps = (tokens: Token[]): Op[] => {
  const ops: Op[] = [];
  let args: Token[] = [];
  for (const t of tokens) {
    if (t.t === "word" && !isOperandWord(t.v)) {
      ops.push({ op: t.v, args });
      args = [];
      continue;
    }
    args.push(t);
  }
  return ops;
};

const approxTextLen = (tok: Token): number => {
  if (tok.t === "string") {
    // raw includes parentheses; very rough length estimate
    return Math.max(0, tok.raw.length - 2);
  }
  if (tok.t === "hex") {
    // <..> hex pairs -> bytes
    const inner = tok.raw.slice(1, -1).replace(/\s+/g, "");
    return Math.floor(inner.length / 2);
  }
  return 0;
};

const approxTextLenForTJArrayRaw = (raw: string): number => {
  let len = 0;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === "(") {
      const r = readLiteralString(raw, i);
      len += Math.max(0, r.tok.raw.length - 2);
      i = r.next;
      continue;
    }
    if (ch === "<" && raw[i + 1] !== "<") {
      const r = readHexString(raw, i);
      const inner = r.tok.raw.slice(1, -1).replace(/\s+/g, "");
      len += Math.floor(inner.length / 2);
      i = r.next;
      continue;
    }
    i++;
  }
  return len;
};

const matrixFromPdfArray = (arr: PDFArray): Matrix | undefined => {
  try {
    if (arr.size() < 6) return undefined;
    const nums: number[] = [];
    for (let i = 0; i < 6; i++) {
      const v = arr.lookup(i);
      if (!(v instanceof PDFNumber)) return undefined;
      const n = v.asNumber();
      if (!Number.isFinite(n)) return undefined;
      nums.push(n);
    }
    return nums as Matrix;
  } catch {
    return undefined;
  }
};

const readMatrixOperands = (args: Token[]): Matrix | undefined => {
  if (args.length < 6) return undefined;
  const nums = args.slice(0, 6).map((t) => (t.t === "number" ? t.v : NaN));
  if (nums.some((n) => !Number.isFinite(n))) return undefined;
  return nums as Matrix;
};

type RewriteResult = {
  changed: boolean;
  ops: Op[];
};

const rewriteOps = (params: {
  ops: Op[];
  regions: PdfRect[];
  initialCtm: Matrix;
}): RewriteResult => {
  const { ops, regions, initialCtm } = params;

  const out: Op[] = [];
  let changed = false;

  const ctmStack: Matrix[] = [];
  let ctm: Matrix = initialCtm;

  let inText = false;
  let textMatrix: Matrix = identityMatrix();
  let lineMatrix: Matrix = identityMatrix();
  let fontSize = 12;
  let leading = 0;

  const translate = (tx: number, ty: number): Matrix => [1, 0, 0, 1, tx, ty];

  const estimateAndMaybeRedact = (
    len: number,
  ): { bbox: PdfRect; remove: boolean; adv: number } => {
    const adv = Math.max(0, len) * fontSize * 0.5;
    const h = fontSize;
    const m = mul(ctm, textMatrix);

    const p0 = apply(m, [0, 0]);
    const p1 = apply(m, [adv, 0]);
    const p2 = apply(m, [0, h]);
    const p3 = apply(m, [adv, h]);

    const xs = [p0[0], p1[0], p2[0], p3[0]];
    const ys = [p0[1], p1[1], p2[1], p3[1]];

    const bbox: PdfRect = {
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
    };

    const remove = regions.some((r) => intersects(bbox, r));
    return { bbox, remove, adv };
  };

  const advanceText = (dx: number) => {
    if (!Number.isFinite(dx) || dx === 0) return;
    textMatrix = mul(textMatrix, translate(dx, 0));
  };

  for (let idx = 0; idx < ops.length; idx++) {
    const o = ops[idx]!;

    if (o.op === "q") {
      ctmStack.push(ctm);
      out.push(o);
      continue;
    }
    if (o.op === "Q") {
      const prev = ctmStack.pop();
      if (prev) ctm = prev;
      out.push(o);
      continue;
    }
    if (o.op === "cm") {
      const m = readMatrixOperands(o.args);
      if (m) ctm = mul(ctm, m);
      out.push(o);
      continue;
    }

    if (o.op === "BT") {
      inText = true;
      textMatrix = identityMatrix();
      lineMatrix = identityMatrix();
      out.push(o);
      continue;
    }
    if (o.op === "ET") {
      inText = false;
      out.push(o);
      continue;
    }

    if (inText && o.op === "Tf") {
      const sizeTok = o.args[1];
      if (sizeTok?.t === "number" && Number.isFinite(sizeTok.v)) {
        fontSize = sizeTok.v;
      }
      out.push(o);
      continue;
    }

    if (inText && o.op === "TL") {
      const t = o.args[0];
      if (t?.t === "number" && Number.isFinite(t.v)) leading = t.v;
      out.push(o);
      continue;
    }

    if (inText && o.op === "Tm") {
      const m = readMatrixOperands(o.args);
      if (m) {
        textMatrix = m;
        lineMatrix = m;
      }
      out.push(o);
      continue;
    }

    if (inText && o.op === "Td") {
      const tx = o.args[0]?.t === "number" ? o.args[0].v : NaN;
      const ty = o.args[1]?.t === "number" ? o.args[1].v : NaN;
      if (Number.isFinite(tx) && Number.isFinite(ty)) {
        lineMatrix = mul(lineMatrix, translate(tx, ty));
        textMatrix = lineMatrix;
      }
      out.push(o);
      continue;
    }

    if (inText && o.op === "T*") {
      if (Number.isFinite(leading) && leading !== 0) {
        lineMatrix = mul(lineMatrix, translate(0, -leading));
        textMatrix = lineMatrix;
      }
      out.push(o);
      continue;
    }

    if (inText && (o.op === "Tj" || o.op === "'" || o.op === '"')) {
      if (o.op === "'" || o.op === '"') {
        if (Number.isFinite(leading) && leading !== 0) {
          lineMatrix = mul(lineMatrix, translate(0, -leading));
          textMatrix = lineMatrix;
        }
      }
      const textTok = o.op === "Tj" ? o.args[0] : o.args[o.args.length - 1];
      const len = textTok ? approxTextLen(textTok) : 0;
      const { remove, adv } = estimateAndMaybeRedact(len);
      advanceText(adv);

      if (remove) {
        changed = true;
        continue;
      }

      out.push(o);
      continue;
    }

    if (inText && o.op === "TJ") {
      const arrTok = o.args[0];
      const len =
        arrTok?.t === "array" ? approxTextLenForTJArrayRaw(arrTok.raw) : 0;
      const { remove, adv } = estimateAndMaybeRedact(len);
      advanceText(adv);

      if (remove) {
        changed = true;
        continue;
      }

      out.push(o);
      continue;
    }

    out.push(o);
  }

  return { changed, ops: out };
};

const rewriteStreamContent = async (params: {
  pdfDoc: PDFDocument;
  stream: PDFStream;
  resources: PDFDict | undefined;
  regions: PdfRect[];
  initialCtm: Matrix;
  xObjectNameCounter: { n: number };
  xObjectInstanceCache: Map<string, { name: string; ref: PDFRef }>;
  depth: number;
}): Promise<{ changed: boolean; content?: string }> => {
  const {
    pdfDoc,
    stream,
    resources,
    regions,
    initialCtm,
    xObjectNameCounter,
    xObjectInstanceCache,
    depth,
  } = params;

  const filters = extractPdfStreamFilters(stream);
  if (filters.includes("FlateDecode") && !hasDecompressionStream()) {
    return { changed: false };
  }
  if (filters.some((f) => f !== "FlateDecode")) {
    return { changed: false };
  }

  const decoded = await decodePdfStreamToText(stream);
  if (!decoded || decoded.trim() === "") return { changed: false };

  const ops = parseOps(tokenize(decoded));

  // Pass 1: redact text operators only (no async)
  const r1 = rewriteOps({
    ops,
    regions,
    initialCtm,
  });

  // Pass 2: recurse into Form XObjects referenced by Do (async)
  let changed = r1.changed;
  const outOps: Op[] = [];

  const ensureXObjectDict = (res: PDFDict) => {
    let xobj = res.lookup(PDFName.of("XObject"));
    if (!(xobj instanceof PDFDict)) {
      xobj = pdfDoc.context.obj({});
      res.set(PDFName.of("XObject"), xobj);
    }
    return xobj as PDFDict;
  };

  const allocXObjectName = (xobjDict: PDFDict) => {
    for (let tries = 0; tries < 10000; tries++) {
      xObjectNameCounter.n += 1;
      const name = `Xr${xObjectNameCounter.n}`;
      const k = PDFName.of(name);
      if (!xobjDict.has(k)) return name;
    }
    return `Xr${Date.now()}`;
  };

  const readMatrix = (xobj: PDFStream): Matrix => {
    const mObj = xobj.dict.lookup(PDFName.of("Matrix"));
    if (mObj instanceof PDFArray) {
      const m = matrixFromPdfArray(mObj);
      if (m) return m;
    }
    return identityMatrix();
  };

  const getFormResources = (xobj: PDFStream): PDFDict | undefined => {
    const rObj = xobj.dict.lookup(PDFName.of("Resources"));
    return rObj instanceof PDFDict ? rObj : undefined;
  };

  // Lightweight CTM interpreter so we can compute instance CTM at each Do.
  let ctm: Matrix = initialCtm;
  const ctmStack: Matrix[] = [];

  for (const o of r1.ops) {
    if (o.op === "q") {
      ctmStack.push(ctm);
      outOps.push(o);
      continue;
    }
    if (o.op === "Q") {
      const prev = ctmStack.pop();
      if (prev) ctm = prev;
      outOps.push(o);
      continue;
    }
    if (o.op === "cm") {
      const m = readMatrixOperands(o.args);
      if (m) ctm = mul(ctm, m);
      outOps.push(o);
      continue;
    }

    if (o.op === "Do" && o.args.length >= 1 && resources instanceof PDFDict) {
      const nameTok = o.args[0];
      if (nameTok?.t === "name") {
        const xobjDictObj = resources.lookup(PDFName.of("XObject"));
        const xobjDict =
          xobjDictObj instanceof PDFDict ? xobjDictObj : undefined;
        if (xobjDict) {
          const rawRef = xobjDict.get(PDFName.of(nameTok.v));
          const formRef = rawRef instanceof PDFRef ? rawRef : undefined;
          const form = xobjDict.lookup(PDFName.of(nameTok.v));
          if (form instanceof PDFStream && formRef) {
            const subtype = form.dict.lookup(PDFName.of("Subtype"));
            if (subtype === PDFName.of("Form")) {
              const formMatrix = readMatrix(form);
              const instanceCtm = mul(ctm, formMatrix);
              const ctmKey = instanceCtm
                .map((n) => (Math.abs(n) < 1e-9 ? 0 : Number(n.toFixed(6))))
                .join(",");
              const cacheKey = `${formRef.objectNumber}:${formRef.generationNumber}|${ctmKey}|d${depth}`;

              let mapped = xObjectInstanceCache.get(cacheKey);
              if (!mapped) {
                const childResources = getFormResources(form);
                const child = await rewriteStreamContent({
                  pdfDoc,
                  stream: form,
                  resources: childResources,
                  regions,
                  initialCtm: instanceCtm,
                  xObjectNameCounter,
                  xObjectInstanceCache,
                  depth: depth + 1,
                });

                if (child.changed && typeof child.content === "string") {
                  const dictObj: Record<string, PDFObject> = {};
                  for (const [k, v] of form.dict.entries()) {
                    const key = trimSlash(k.decodeText());
                    if (
                      key === "Length" ||
                      key === "Filter" ||
                      key === "DecodeParms"
                    )
                      continue;
                    dictObj[key] = v;
                  }

                  const newStream = pdfDoc.context.stream(
                    child.content,
                    dictObj,
                  );
                  const newRef = pdfDoc.context.register(newStream);

                  const res = resources;
                  const pageXObj = ensureXObjectDict(res);
                  const newName = allocXObjectName(pageXObj);
                  pageXObj.set(PDFName.of(newName), newRef);

                  mapped = { name: newName, ref: newRef };
                  xObjectInstanceCache.set(cacheKey, mapped);
                  changed = true;
                } else {
                  mapped = { name: nameTok.v, ref: formRef };
                  xObjectInstanceCache.set(cacheKey, mapped);
                }
              }

              if (mapped.name !== nameTok.v) {
                outOps.push({
                  op: "Do",
                  args: [{ t: "name", v: mapped.name }],
                });
                changed = true;
                continue;
              }
            }
          }
        }
      }

      outOps.push(o);
      continue;
    }

    outOps.push(o);
  }

  if (!changed) return { changed: false };
  return { changed: true, content: encodeOps(outOps) };
};

export const applyTextRedactionsUnderFlattenedFreetext = async (args: {
  pdfDoc: PDFDocument;
  pages: PDFPage[];
  annotations: Annotation[];
  getViewportForPage: (pageIndex: number) => Promise<ViewportLike | undefined>;
}): Promise<void> => {
  const { pdfDoc, pages, annotations, getViewportForPage } = args;

  if (!hasDecompressionStream()) return;

  const regionsByPage = new Map<number, PdfRect[]>();

  for (const a of annotations) {
    if (a.type !== "freetext") continue;
    if (!a.flatten) continue;
    if (!a.rect) continue;

    const page = pages[a.pageIndex];
    if (!page) continue;
    const viewport = await getViewportForPage(a.pageIndex);
    const b = uiRectToPdfBounds(page, a.rect, viewport);

    const region: PdfRect = {
      x0: b.x,
      y0: b.y,
      x1: b.x + b.width,
      y1: b.y + b.height,
    };

    const arr = regionsByPage.get(a.pageIndex) || [];
    arr.push(region);
    regionsByPage.set(a.pageIndex, arr);
  }

  if (regionsByPage.size === 0) return;

  const xObjectNameCounter = { n: 0 };

  for (const [pageIndex, regions] of regionsByPage.entries()) {
    const page = pages[pageIndex];
    if (!page) continue;

    const contentsObj = page.node.lookup(PDFName.of("Contents"));
    if (!contentsObj) continue;

    let resources = page.node.Resources();
    if (!(resources instanceof PDFDict)) {
      resources = pdfDoc.context.obj({});
      page.node.set(PDFName.of("Resources"), resources);
    }

    const xObjectInstanceCache = new Map<
      string,
      { name: string; ref: PDFRef }
    >();

    const rewriteOne = async (stream: PDFStream): Promise<PDFRef | null> => {
      const r = await rewriteStreamContent({
        pdfDoc,
        stream,
        resources,
        regions,
        initialCtm: identityMatrix(),
        xObjectNameCounter,
        xObjectInstanceCache,
        depth: 0,
      });
      if (!r.changed || typeof r.content !== "string") return null;

      const newStream = pdfDoc.context.stream(r.content, {});
      const ref = pdfDoc.context.register(newStream);
      return ref;
    };

    if (contentsObj instanceof PDFStream) {
      const ref = await rewriteOne(contentsObj);
      if (ref) page.node.set(PDFName.of("Contents"), ref);
      continue;
    }

    if (contentsObj instanceof PDFArray) {
      const refs: PDFRef[] = [];
      let any = false;
      for (let i = 0; i < contentsObj.size(); i++) {
        const raw = contentsObj.get(i);
        const itemRef = raw instanceof PDFRef ? raw : undefined;
        const item = contentsObj.lookup(i);

        if (!(item instanceof PDFStream)) {
          if (itemRef) refs.push(itemRef);
          continue;
        }
        const ref = await rewriteOne(item);
        if (ref) {
          refs.push(ref);
          any = true;
        } else {
          if (itemRef) refs.push(itemRef);
        }
      }
      if (any) {
        const newArr = pdfDoc.context.obj(refs);
        page.node.set(PDFName.of("Contents"), newArr);
      }
    }
  }
};
