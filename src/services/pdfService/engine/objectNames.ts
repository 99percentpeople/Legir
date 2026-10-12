import type { PDFDocument, PDFObject } from "mupdf";
import type { MuPdfModule } from "./mupdf";

/** MuPDF's asName()/forEach decode names as UTF-8, but PDF names are byte
 * sequences. Read key tokens from MuPDF's canonical ASCII object spelling.
 * This walks an already parsed object, never PDF files/content streams. */
export function dictionaryKeyNames(object: PDFObject): string[] {
  const source = object.toString(true, true);
  let position = 0;
  const space = () => {
    while (/\s/.test(source[position] ?? "") && position < source.length)
      position++;
  };
  const token = () => {
    const start = position;
    while (position < source.length && !/[\s()[\]<>/]/.test(source[position]))
      position++;
    if (position === start) throw new Error("Invalid native PDF object token.");
    return source.slice(start, position);
  };
  const name = () => {
    space();
    if (source[position++] !== "/")
      throw new Error("Invalid native PDF dictionary key.");
    const start = position;
    while (position < source.length && !/[\s()[\]<>/]/.test(source[position]))
      position++;
    return source.slice(start, position);
  };
  const skipValue = (depth: number) => {
    if (depth > 100) throw new Error("PDF object nesting limit exceeded.");
    space();
    if (source.startsWith("<<", position)) {
      position += 2;
      space();
      while (!source.startsWith(">>", position)) {
        name();
        skipValue(depth + 1);
        space();
      }
      position += 2;
    } else if (source[position] === "[") {
      position++;
      space();
      while (source[position] !== "]") {
        skipValue(depth + 1);
        space();
      }
      position++;
    } else if (source[position] === "(") {
      position++;
      let nesting = 1;
      while (nesting && position < source.length) {
        const char = source[position++];
        if (char === "\\") position++;
        else if (char === "(") nesting++;
        else if (char === ")") nesting--;
      }
      if (nesting) throw new Error("Invalid native PDF string.");
    } else if (source[position] === "<") {
      const end = source.indexOf(">", position);
      if (end < 0) throw new Error("Invalid native PDF byte string.");
      position = end + 1;
    } else if (source[position] === "/") {
      name();
    } else {
      const word = token();
      if (/^\d+$/.test(word)) {
        const afterNumber = position;
        const reference = /^\s+\d+\s+R\b/.exec(source.slice(position));
        position = reference ? position + reference[0].length : afterNumber;
      }
    }
  };
  if (!source.startsWith("<<"))
    throw new Error("Expected a native PDF dictionary.");
  position = 2;
  const keys: string[] = [];
  space();
  while (!source.startsWith(">>", position)) {
    keys.push(name());
    skipValue(1);
    space();
  }
  return keys;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** A document-scoped pool keeps arbitrary name bytes intact through native
 * object construction. Common UTF-8 names use the direct native API. */
export class NativeNames {
  private readonly names = new Map<string, PDFObject>();
  private readonly integers = new Map<number, PDFObject>();
  constructor(
    private readonly mupdf: MuPdfModule,
    private readonly doc: PDFDocument,
  ) {}

  get(spelling: string): PDFObject {
    let name = this.names.get(spelling);
    if (name) return name;
    const bytes: number[] = [];
    for (let index = 0; index < spelling.length; index++) {
      if (
        spelling[index] === "#" &&
        /^[\da-f]{2}$/i.test(spelling.slice(index + 1, index + 3))
      ) {
        bytes.push(parseInt(spelling.slice(index + 1, index + 3), 16));
        index += 2;
      } else bytes.push(spelling.charCodeAt(index));
    }
    let decoded: string | undefined;
    try {
      decoded = utf8.decode(new Uint8Array(bytes));
    } catch {
      /* Names need not be UTF-8. */
    }
    if (decoded !== undefined) name = this.doc.newName(decoded);
    else {
      // Use MuPDF itself to intern a byte name. The public JS newName API only
      // accepts Unicode, so a tiny valid PDF carries its canonical spelling.
      if (
        [...spelling].some(
          (char) =>
            char.charCodeAt(0) <= 0x20 ||
            char.charCodeAt(0) >= 0x7f ||
            "()[]<>/%".includes(char),
        )
      )
        throw new Error("Invalid PDF name spelling.");
      const wasm = globalThis.$libmupdf_wasm_Module;
      if (wasm?._wasm_pdf_new_name && wasm.HEAPU8) {
        // Pinned MuPDF binding: intern the original bytes without opening a
        // second document merely to parse a non-UTF-8 resource name.
        const pointer = wasm._wasm_malloc(bytes.length + 1);
        try {
          wasm.HEAPU8.set(bytes, pointer);
          wasm.HEAPU8[pointer + bytes.length] = 0;
          name = this.doc._fromPDFObjectNew(wasm._wasm_pdf_new_name(pointer));
        } finally {
          wasm._wasm_free(pointer);
        }
      } else name = parseNativeScalar(this.mupdf, this.doc, "/" + spelling);
    }
    this.names.set(spelling, name);
    return name;
  }

  rememberInteger(value: number, object: PDFObject) {
    if (
      Number.isInteger(value) &&
      (value < -2147483648 || value > 2147483647) &&
      !this.integers.has(value)
    )
      this.integers.set(value, this.doc._fromPDFObjectKeep(object.pointer));
  }

  integer(value: number) {
    const original = this.integers.get(value);
    if (original) return this.doc._fromPDFObjectKeep(original.pointer);
    return value >= -2147483648 && value <= 2147483647
      ? this.doc.newInteger(value)
      : parseNativeScalar(this.mupdf, this.doc, String(value));
  }

  destroy() {
    for (const name of this.names.values()) name.destroy();
    this.names.clear();
    for (const integer of this.integers.values()) integer.destroy();
    this.integers.clear();
  }
}

/** The JS newInteger binding is 32-bit; native parsing retains larger PDF
 * integers. This also supplies arbitrary byte names absent from the JS API. */
function parseNativeScalar(
  mupdf: MuPdfModule,
  doc: PDFDocument,
  spelling: string,
): PDFObject {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /Value " + spelling + " >>",
    "<< /Type /Pages /Kids [] /Count 0 >>",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 3\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const buffer = new mupdf.Buffer(pdf);
  const scratch = new mupdf.PDFDocument(buffer);
  buffer.destroy();
  const trailer = scratch.getTrailer();
  const rawName = trailer.get("Root", "Value");
  try {
    return doc.graftObject(rawName);
  } finally {
    rawName.destroy();
    trailer.destroy();
    scratch.destroy();
  }
}
