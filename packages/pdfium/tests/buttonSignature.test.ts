import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPDFium, type PDFium } from "../src/index.js";
import {
  NativeEditingContext,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFStream,
  PDFHexString,
  type PDFButtonLayout,
} from "../src/authoring/index.js";

let engine: PDFium;
const views: NativeEditingContext[] = [];
beforeAll(async () => {
  engine = await createPDFium();
});
afterEach(() => {
  for (const view of views.splice(0)) {
    view.dispose();
    view.native.destroy();
  }
  expect(engine.liveDocuments()).toBe(0);
});
const document = (bytes?: Uint8Array) => {
  const view = new NativeEditingContext(engine, new engine.PDFDocument(bytes));
  views.push(view);
  return view.document;
};
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAGUlEQVR4nD3BMQEAAAjAILR/5/kJJIi28Q5Y5gT/nBWRrgAAAABJRU5ErkJggg==";

describe("pushbutton authoring and native signature domains", () => {
  it("stores icons, fit and captions in standard widget /MK entries", async () => {
    const doc = document(),
      page = doc.addPage([300, 200]);
    const button = doc.getForm().createButton("photo");
    button.addToPage("Photo", page, { x: 20, y: 30, width: 180, height: 100 });
    button.setImage(await doc.embedPng(png));
    button.setLayout(2);
    button.setImageFit({
      scaleMode: "fill",
      alignment: [0, 1],
      when: "bigger",
      fitBounds: true,
    });
    button.setFontSize(10);
    const saved = document(await doc.save());
    const result = saved.getForm().getButton("photo");
    const widget = result.acroField.getWidgets()[0];
    const mk = widget.dict.lookup(PDFName.of("MK"), PDFDict);
    expect(result.getCaption()).toBe("Photo");
    expect(result.getLayout()).toBe(2);
    expect(result.getImageFit()).toEqual({
      scaleMode: "fill",
      alignment: [0, 1],
      when: "bigger",
      fitBounds: true,
    });
    expect(mk.lookup(PDFName.of("I"))).toBeInstanceOf(PDFStream);
    expect(mk.lookup(PDFName.of("TP"), PDFNumber).asNumber()).toBe(2);
    expect(result.acroField.getFlags() & (1 << 16)).toBeTruthy();
    expect(result.acroField.dict.has(PDFName.of("V"))).toBe(false);
    result.setImage(undefined);
    result.updateAppearances();
    expect(result.getIcon()).toBeUndefined();
    expect(widget.getAppearances().normal).toBeInstanceOf(PDFStream);
  });
  it("updates only the requested button widget and validates layout and alignment", () => {
    const doc = document(),
      page = doc.addPage([300, 200]);
    const button = doc.getForm().createButton("shared");
    button.addToPage("First", page);
    button.addToPage("Second", page);
    const widgets = button.acroField.getWidgets();
    button.setCaption("Changed", widgets[1]);
    button.updateWidgetAppearance(widgets[1]);
    expect(button.getCaption(widgets[0])).toBe("First");
    expect(button.getCaption(widgets[1])).toBe("Changed");
    expect(() => button.setLayout(7 as PDFButtonLayout)).toThrow();
    expect(() => button.setImageFit({ alignment: [NaN, 0] })).toThrow();
    expect(() => button.setImageFit({ alignment: [0, 2] })).toThrow();
  });
  it("releases temporary image resources before journal rollback reuses object numbers", async () => {
    const source = document();
    source.addPage([360, 240]);
    await source.flush();
    const native = source.nativeView!.native;
    const colored: number[] = [];
    for (const includeImage of [true, false, true, true]) {
      native.beginOperation("thumbnail overlay");
      const view = new NativeEditingContext(engine, native);
      try {
        const doc = view.document;
        doc.catalog.delete(PDFName.of("AcroForm"));
        const overlay = doc.addPage([360, 240]);
        const button = doc.getForm().createButton("photo");
        button.addToPage("Photo", overlay, {
          x: 20,
          y: 80,
          width: 180,
          height: 100,
        });
        button.setLayout(2);
        if (includeImage) button.setImage(await doc.embedPng(png));
        button.updateAppearances();
        doc
          .getForm()
          .createSignature("approval")
          .addToPage(overlay, { x: 20, y: 20, width: 180, height: 40 });
        await view.flush();
        native.setPageTreeCache(false);
        const page = native.loadPage(1);
        try {
          const bitmap = page.render([1, 0, 0, 1, 0, 0], [0, 0, 360, 240], {
            annotations: true,
            transparent: true,
            imageCache: "reuse",
          });
          try {
            let blue = 0;
            const pixels = bitmap.getPixels();
            for (let i = 0; i < pixels.length; i += 4)
              if (
                pixels[i] < 80 &&
                pixels[i + 1] < 80 &&
                pixels[i + 2] > 180 &&
                pixels[i + 3] > 180
              )
                blue++;
            colored.push(blue);
          } finally {
            bitmap.destroy();
          }
        } finally {
          page.destroy();
        }
      } finally {
        view.dispose();
        native.abandonOperation();
      }
      expect(native.countPages()).toBe(1);
    }
    expect(colored[0]).toBeGreaterThan(100);
    expect(colored[1]).toBe(0);
    expect(colored[2]).toBe(colored[0]);
    expect(colored[3]).toBe(colored[0]);
  });
  it("creates an unsigned /Sig rather than a text field or image stamp", async () => {
    const doc = document(),
      page = doc.addPage([300, 200]);
    const signature = doc.getForm().createSignature("approval");
    signature.addToPage(page, { x: 20, y: 30, width: 180, height: 40 });
    const saved = document(await doc.save()),
      result = saved.getForm().getSignature("approval");
    expect(result.acroField.dict.lookup(PDFName.of("FT"))).toBe(
      PDFName.of("Sig"),
    );
    expect(result.getSignatureInfo()).toBeUndefined();
    expect(result.acroField.dict.has(PDFName.of("V"))).toBe(false);
    expect(
      result.acroField.getWidgets()[0].getAppearances().normal,
    ).toBeInstanceOf(PDFStream);
  });
  it("never regenerates or asserts validity of an existing signature appearance", async () => {
    const doc = document(),
      page = doc.addPage([300, 200]);
    const signature = doc.getForm().createSignature("existing");
    signature.addToPage(page);
    const appearance = signature.acroField
      .getWidgets()[0]
      .getAppearances().normal;
    signature.acroField.dict.set(
      PDFName.of("V"),
      doc.context.obj({
        Type: "Sig",
        Name: PDFHexString.fromText("Declared name"),
        Contents: PDFHexString.of("0000"),
      }),
    );
    signature.enableRequired();
    expect(signature.needsAppearancesUpdate()).toBe(false);
    signature.updateAppearances();
    expect(signature.acroField.getWidgets()[0].getAppearances().normal).toBe(
      appearance,
    );
    expect(signature.getSignatureInfo()).toMatchObject({
      present: true,
      name: "Declared name",
    });
    expect(() => signature.addToPage(page)).toThrow(/populated signature/);
    const saved = document(await doc.save());
    expect(
      saved.getForm().getSignature("existing").getSignatureInfo()?.present,
    ).toBe(true);
  });
});
