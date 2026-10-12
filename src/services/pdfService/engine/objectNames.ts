import { decodeName, type PDFDocument, type PDFObject } from "@legir/pdfium";
import type { PDFiumModule } from "./pdfium";

export const dictionaryKeyNames = (object: PDFObject) => object.keys();

/** Names are byte sequences, not necessarily valid UTF-8. */
export class NativeNames {
  private readonly names = new Map<string, PDFObject>();
  constructor(
    _engine: PDFiumModule,
    private readonly doc: PDFDocument,
  ) {}
  get(spelling: string) {
    let name = this.names.get(spelling);
    if (!name) {
      name = this.doc.newNameBytes(decodeName(spelling));
      this.names.set(spelling, name);
    }
    return name;
  }
  rememberInteger(_value: number, _object: PDFObject) {}
  integer(value: number) {
    return this.doc.newInteger(value);
  }
  destroy() {
    for (const name of this.names.values()) name.destroy();
    this.names.clear();
  }
}
