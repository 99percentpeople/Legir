import { describe, expect, it } from "vitest";
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from "@cantoo/pdf-lib";
import { exportPDF, exportPDFBlob, loadPDF } from "@/services/pdfService";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createTestEditorStore } from "../helpers/editorStore";
import { getPageId } from "@/services/pdfService/lib/pageStructure";
import { duplicateAnnotationForDrag } from "@/components/workspace/lib/duplicateControlForDrag";

const worker = {
  loadDocument: async () => true,
  getOutline: async () => [],
  getPermissions: async () => null,
  resolveDest: async () => null,
} as unknown as PDFWorkerService;

// Like INDOT page 217: child-first review-state chain, each with its own popup.
const fixture = async (
  malformed?: "cycle" | "orphan" | "group" | "empty-root",
) => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const refs: PDFRef[] = [];
  const popups: PDFRef[] = [];
  for (const state of ["Accepted", "Completed", "Corrected"]) {
    const dict = doc.context.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [20, 20, 44, 44],
      Contents: PDFString.of(state),
      F: 30,
      State: PDFString.of(state),
      StateModel: PDFString.of("Review"),
      P: page.ref,
      ...(refs.length ? { IRT: refs.at(-1), RT: "R" } : {}),
    });
    const ref = doc.context.register(dict);
    const popup = doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Popup",
        Parent: ref,
        P: page.ref,
        Rect: [60, 20, 200, 180],
      }),
    );
    dict.set(PDFName.of("Popup"), popup);
    refs.push(ref);
    popups.push(popup);
  }
  if (malformed === "cycle")
    doc.context.lookup(refs[1], PDFDict).set(PDFName.of("IRT"), refs[2]);
  if (malformed === "orphan")
    doc.context.lookup(refs[1], PDFDict).set(PDFName.of("IRT"), PDFRef.of(999));
  if (malformed === "group")
    doc.context
      .lookup(refs[1], PDFDict)
      .set(PDFName.of("RT"), PDFName.of("Group"));
  if (malformed === "empty-root")
    doc.context.lookup(refs[0], PDFDict).delete(PDFName.of("Contents"));
  page.node.set(
    PDFName.of("Annots"),
    doc.context.obj([...refs, ...popups].reverse()),
  );
  return { bytes: await doc.save(), refs, popups };
};
const open = async (bytes: Uint8Array) => {
  const loaded = await loadPDF(bytes, { workerService: worker });
  const store = createTestEditorStore({ ...loaded, pdfBytes: bytes });
  return {
    loaded,
    store,
    dispose: () => {
      store.dispose();
      loaded.dispose();
    },
  };
};
const saveWith = async (
  store: ReturnType<typeof createTestEditorStore>,
  mode: "bytes" | "blob",
) => {
  const state = store.getState();
  const output = await (mode === "blob" ? exportPDFBlob : exportPDF)(
    state.pdfBytes!,
    state.fields,
    state.metadata,
    state.annotations,
    undefined,
    {
      pageStructure: { pages: state.pages, sources: state.pageSources },
      preservedSourceAnnotations: state.preservedSourceAnnotations,
    },
  );
  return output instanceof Blob
    ? new Uint8Array(await output.arrayBuffer())
    : output;
};
const inspect = (doc: PDFDocument, pageIndex = 0) => {
  const page = doc.getPage(pageIndex);
  const refs = page.node.Annots()?.asArray() ?? [];
  const text = refs.filter(
    (ref) =>
      doc.context.lookup(ref, PDFDict).get(PDFName.of("Subtype")) ===
      PDFName.of("Text"),
  );
  const popups = refs.filter(
    (ref) =>
      doc.context.lookup(ref, PDFDict).get(PDFName.of("Subtype")) ===
      PDFName.of("Popup"),
  );
  const states = new Map(
    text.map((ref) => [
      doc.context
        .lookup(ref, PDFDict)
        .lookup(PDFName.of("State"), PDFString, PDFHexString)
        .decodeText(),
      ref,
    ]),
  );
  for (const ref of text) {
    const dict = doc.context.lookup(ref, PDFDict);
    expect(dict.lookup(PDFName.of("F"), PDFNumber).asNumber()).toBe(30);
    expect(
      dict
        .lookup(PDFName.of("StateModel"), PDFString, PDFHexString)
        .decodeText(),
    ).toBe("Review");
    expect(dict.get(PDFName.of("P"))).toEqual(page.ref);
    const popup = dict.get(PDFName.of("Popup"));
    expect(popups).toContainEqual(popup);
    expect(
      doc.context.lookup(popup, PDFDict).get(PDFName.of("Parent")),
    ).toEqual(ref);
  }
  expect(popups).toHaveLength(text.length);
  return { states, text, popups };
};
const expectChain = (doc: PDFDocument, pageIndex = 0) => {
  const { states, text } = inspect(doc, pageIndex);
  expect(text).toHaveLength(3);
  expect(
    doc.context.lookup(states.get("Completed"), PDFDict).get(PDFName.of("IRT")),
  ).toEqual(states.get("Accepted"));
  expect(
    doc.context.lookup(states.get("Corrected"), PDFDict).get(PDFName.of("IRT")),
  ).toEqual(states.get("Completed"));
  return states;
};

describe.each(["bytes", "blob"] as const)(
  "nested annotation reply round-trips (%s)",
  (mode) => {
    const save = (store: ReturnType<typeof createTestEditorStore>) =>
      saveWith(store, mode);
    it("imports child-first replies and preserves all states, flags and popup pairs across repeated saves", async () => {
      const { bytes } = await fixture();
      const session = await open(bytes);
      try {
        const [root] = session.loaded.annotations;
        expect(session.loaded.annotations).toHaveLength(1);
        expect(root.replies).toHaveLength(2);
        const middle = root.replies!.find((r) => r.text === "Completed")!;
        expect(
          root.replies!.find((r) => r.text === "Corrected")?.inReplyToReplyId,
        ).toBe(middle.id);
        const output = await save(session.store);
        expectChain(await PDFDocument.load(output));
        const reopened = await open(output);
        try {
          expectChain(await PDFDocument.load(await save(reopened.store)));
        } finally {
          reopened.dispose();
        }
      } finally {
        session.dispose();
      }
    });

    it("edits a middle reply and rebuilds the root without flattening /IRT or losing review metadata", async () => {
      const { bytes } = await fixture();
      const session = await open(bytes);
      try {
        const [root] = session.loaded.annotations;
        const middle = root.replies!.find((r) => r.text === "Completed")!;
        session.store
          .getState()
          .updateAnnotationReply(root.id, middle.id, { text: "Edited reply" });
        session.store
          .getState()
          .updateAnnotation(root.id, { text: "Edited root" });
        const doc = await PDFDocument.load(await save(session.store));
        const states = expectChain(doc);
        expect(
          doc.context
            .lookup(states.get("Completed"), PDFDict)
            .lookup(PDFName.of("Contents"), PDFHexString)
            .decodeText(),
        ).toBe("Edited reply");
        expect(
          doc.context
            .lookup(states.get("Accepted"), PDFDict)
            .lookup(PDFName.of("Contents"), PDFHexString)
            .decodeText(),
        ).toBe("Edited root");
      } finally {
        session.dispose();
      }
    });

    it("deletes only the chosen reply, reparents its children and removes its popup; undo restores the chain", async () => {
      const session = await open((await fixture()).bytes);
      try {
        const [root] = session.loaded.annotations;
        session.store
          .getState()
          .deleteAnnotationReply(
            root.id,
            root.replies!.find((r) => r.text === "Completed")!.id,
          );
        const doc = await PDFDocument.load(await save(session.store));
        const { states, text } = inspect(doc);
        expect(text).toHaveLength(2);
        expect(
          doc.context
            .lookup(states.get("Corrected"), PDFDict)
            .get(PDFName.of("IRT")),
        ).toEqual(states.get("Accepted"));
        session.store.getState().undo();
        expectChain(await PDFDocument.load(await save(session.store)));
        session.store.getState().deleteAnnotation(root.id);
        expect(
          inspect(await PDFDocument.load(await save(session.store))).text,
        ).toHaveLength(0);
      } finally {
        session.dispose();
      }
    });

    it("remaps nested reply IDs and PDF refs when duplicating pages", async () => {
      const session = await open((await fixture()).bytes);
      try {
        session.store
          .getState()
          .duplicatePages([getPageId(session.store.getState().pages[0])]);
        const roots = session.store.getState().annotations;
        expect(roots).toHaveLength(2);
        const copied = roots[1].replies!;
        expect(
          copied.find((r) => r.text === "Corrected")?.inReplyToReplyId,
        ).toBe(copied.find((r) => r.text === "Completed")?.id);
        const doc = await PDFDocument.load(await save(session.store));
        const first = expectChain(doc, 0);
        const second = expectChain(doc, 1);
        for (const state of first.keys())
          expect(first.get(state)).not.toEqual(second.get(state));
      } finally {
        session.dispose();
      }
    });

    it("keeps donor replies attached to their own copied page during import", async () => {
      const target = await open((await fixture()).bytes);
      const donorBytes = (await fixture()).bytes;
      const donor = await open(donorBytes);
      try {
        target.store.getState().insertPdfPages(
          {
            ...donor.loaded,
            source: {
              bytes: donorBytes,
              filename: "replies.pdf",
              password: null,
            },
            indexes: [0],
          },
          1,
        );
        const doc = await PDFDocument.load(await save(target.store));
        expectChain(doc, 0);
        expectChain(doc, 1);
      } finally {
        donor.dispose();
        target.dispose();
      }
    });

    it("remaps reply parents when duplicating a control for drag", async () => {
      const session = await open((await fixture()).bytes);
      try {
        const duplicate = duplicateAnnotationForDrag(
          session.loaded.annotations[0],
        );
        const replies = duplicate.replies!;
        expect(
          replies.find((r) => r.text === "Corrected")?.inReplyToReplyId,
        ).toBe(replies.find((r) => r.text === "Completed")?.id);
        expect(
          replies.every(
            (r) => r.parentAnnotationId === duplicate.id && !r.sourcePdfRef,
          ),
        ).toBe(true);
      } finally {
        session.dispose();
      }
    });

    it.each(["cycle", "orphan", "group", "empty-root"] as const)(
      "preserves unsupported %s relationships without looping or dropping objects",
      async (kind) => {
        const { bytes, refs } = await fixture(kind);
        const session = await open(bytes);
        try {
          expect(session.loaded.annotations[0]?.replies ?? []).toHaveLength(
            kind === "empty-root" ? 2 : 0,
          );
          const doc = await PDFDocument.load(await save(session.store));
          expect(inspect(doc).text).toHaveLength(3);
          const before = await PDFDocument.load(bytes);
          for (const ref of refs)
            expect(
              doc.context.lookup(ref, PDFDict).get(PDFName.of("IRT")),
            ).toEqual(
              before.context.lookup(ref, PDFDict).get(PDFName.of("IRT")),
            );
        } finally {
          session.dispose();
        }
      },
    );
  },
);
