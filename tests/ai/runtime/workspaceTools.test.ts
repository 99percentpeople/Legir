import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createWorkspaceAiToolRegistry } from "@/services/ai/chat/workspaceToolRegistry";
import type {
  AiWorkspace,
  AiWorkspaceDocument,
} from "@/services/ai/chat/workspace";
import {
  createDocumentEditorView,
  activateEditorView,
} from "@/store/useEditorView";
import { EventBus } from "@/lib/eventBus";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createAiChatToolContext } from "@/hooks/useAiChatController/toolContext";
import { createAiChatSessionData } from "@/hooks/useAiChatController/sessionPersistence";
import { parseAiDocumentLinkHref } from "@/services/ai/utils/documentLinks";
import { page } from "../../helpers/editorStore";
import * as textGeometry from "@/components/workspace/lib/pdfTextRangeGeometry";

const cleanups: Array<() => void> = [];
afterEach(() => {
  activateEditorView();
  cleanups.splice(0).forEach((fn) => fn());
  vi.restoreAllMocks();
});

function setup() {
  const documents = new Map<string, AiWorkspaceDocument>();
  const lifetimes = new Map<string, AbortController>();
  let active = "A";
  for (const id of ["A", "B"]) {
    const { store, dispose } = createDocumentEditorView({
      filename: `${id}.pdf`,
      documentLoadState: "ready",
      pages: [page(0)],
      pdfBytes: new Uint8Array([1]),
    });
    cleanups.push(dispose);
    const lifetime = new AbortController();
    lifetimes.set(id, lifetime);
    documents.set(id, {
      id,
      store,
      events: new EventBus(),
      signal: lifetime.signal,
      workerService: {} as PDFWorkerService,
      getRoot: () => null,
    });
  }
  const workspace: AiWorkspace = {
    getActiveDocumentId: () => active,
    listDocuments: () =>
      [...documents].map(([id, document]) => ({
        documentId: id,
        filename: document.store.getState().filename,
        pageCount: 1,
        isActive: active === id,
        isDirty: document.store.getState().isDirty,
        loadState: "ready",
      })),
    getDocument: (id) => documents.get(id) ?? null,
    activateDocument: (id) => {
      if (!documents.has(id)) return false;
      active = id;
      activateEditorView(documents.get(id)!.store);
      return true;
    },
  };
  return { documents, lifetimes, workspace };
}

describe("workspace AI targeting", () => {
  it("pins defaults, validates explicit IDs and exposes the live active document", async () => {
    const { workspace } = setup();
    const execute = vi.fn(async () => ({
      payload: { link: "#page=1", text: "read" },
      summary: "read",
    }));
    const createRegistry = vi.fn(() => ({ getDefinitions: () => [], execute }));
    const registry = createWorkspaceAiToolRegistry({
      workspace,
      defaultDocumentId: "A",
      definitions: [
        {
          name: "read",
          description: "read",
          accessType: "read",
          inputSchema: z.object({ page: z.number() }).strict(),
        },
      ],
      createRegistry,
    });
    workspace.activateDocument("B");
    const defaultResult = await registry.execute("read", { args: { page: 1 } });
    expect(defaultResult.payload).toMatchObject({
      documentId: "A",
      link: "#page=1&document=A",
    });
    const explicitResult = await registry.execute("read", {
      document_id: "B",
      args: { page: 1 },
    });
    expect(explicitResult.payload).toMatchObject({ documentId: "B" });
    expect(createRegistry.mock.calls).toEqual([["A"], ["B"]]);
    expect(
      (await registry.execute("read", { document_id: 42, args: {} })).payload,
    ).toMatchObject({ error: "INVALID_ARGUMENTS" });
    expect(
      (await registry.execute("read", { document_id: "missing", args: {} }))
        .payload,
    ).toMatchObject({ error: "DOCUMENT_CLOSED" });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(
      (await registry.execute("list_open_documents", {})).payload,
    ).toMatchObject({
      activeDocumentId: "B",
      defaultDocumentId: "A",
      documents: [
        { documentId: "A", isActive: false },
        { documentId: "B", isActive: true },
      ],
    });
    const schema = registry
      .getDefinitions()
      .find((definition) => definition.name === "read")!.inputSchema;
    expect(
      schema.safeParse({ document_id: "B", args: { page: 1 } }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ document_id: "B", args: { page: "invalid" } }).success,
    ).toBe(false);
  });

  it("cancels an operation when its document closes without touching another tab", async () => {
    const { workspace, documents, lifetimes } = setup();
    let taskSignal: AbortSignal | undefined;
    let finish!: () => void;
    const registry = createWorkspaceAiToolRegistry({
      workspace,
      defaultDocumentId: "A",
      definitions: [
        {
          name: "slow",
          accessType: "read",
          description: "slow",
          inputSchema: z.object({}),
        },
      ],
      createRegistry: () => ({
        getDefinitions: () => [],
        execute: async (_name, _args, signal) => {
          taskSignal = signal;
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return { payload: { text: "late A" }, summary: "late" };
        },
      }),
    });
    const pending = registry.execute("slow", { args: {} });
    workspace.activateDocument("B");
    documents.delete("A");
    lifetimes.get("A")!.abort();
    expect(taskSignal?.aborted).toBe(true);
    finish();
    expect((await pending).payload).toMatchObject({ error: "DOCUMENT_CLOSED" });
    expect(documents.get("B")!.store.getState().isDirty).toBe(false);
    expect(workspace.getActiveDocumentId()).toBe("B");
  });

  it("binds actual annotation and metadata mutations to a background document", () => {
    const { workspace, documents } = setup();
    const a = documents.get("A")!,
      b = documents.get("B")!;
    workspace.activateDocument("B");
    const ctx = createAiChatToolContext({
      store: a.store,
      events: a.events,
      documentId: "A",
      workerService: a.workerService,
      searchResultsRef: { current: new Map() },
      searchSeqRef: { current: 0 },
      sessionsRef: {
        current: new Map([
          ["chat", createAiChatSessionData("chat", new Date().toISOString())],
        ]),
      },
      activeSessionIdRef: { current: "chat" },
      setHighlightedResultIds: () => {},
      formToolsEnabled: true,
      selectedChatModelAuthor: "AI",
    });
    ctx.updateDocumentMetadata({ title: "Updated only A" });
    ctx.createFormFields({
      fields: [
        {
          pageNumber: 1,
          name: "Name",
          type: "text",
          rect: { x: 1, y: 1, width: 100, height: 20 },
        },
      ],
    });
    expect(a.store.getState().metadata.title).toBe("Updated only A");
    expect(a.store.getState().fields).toHaveLength(1);
    expect(b.store.getState().metadata.title).not.toBe("Updated only A");
    expect(b.store.getState().fields).toHaveLength(0);
    expect(b.store.getState().isDirty).toBe(false);
  });

  it("uses the latest attachment block with original indices and cancels late highlight writes", async () => {
    const { documents } = setup();
    const geometry = {
      rect: { x: 0, y: 0, width: 100, height: 10 },
      rects: [{ x: 0, y: 0, width: 100, height: 10 }],
    };
    const resolveGeometry = vi
      .spyOn(textGeometry, "resolvePdfTextRangeGeometry")
      .mockResolvedValue(geometry);
    const chat = createAiChatSessionData("chat", new Date().toISOString());
    const selection = {
      kind: "workspace_selection" as const,
      text: "Hello world",
      pageIndex: 0,
      startOffset: 0,
      endOffset: 11,
      rect: geometry.rect,
    };
    chat.timeline = [
      {
        id: "old",
        kind: "message",
        role: "user",
        text: "A",
        createdAt: chat.updatedAt,
        attachments: [{ ...selection, documentId: "A" }],
      },
      {
        id: "latest",
        kind: "message",
        role: "user",
        text: "B",
        createdAt: chat.updatedAt,
        attachments: [
          {
            kind: "annotation_reference",
            annotationId: "note",
            annotationType: "comment",
            pageIndex: 0,
            documentId: "B",
          },
          { ...selection, documentId: "B" },
        ],
      },
    ];
    const context = (id: string) =>
      createAiChatToolContext({
        store: documents.get(id)!.store,
        documentId: id,
        workerService: documents.get(id)!.workerService,
        searchResultsRef: { current: new Map() },
        searchSeqRef: { current: 0 },
        sessionsRef: { current: new Map([[chat.id, chat]]) },
        activeSessionIdRef: { current: chat.id },
        setHighlightedResultIds: () => {},
        formToolsEnabled: true,
        selectedChatModelAuthor: "AI",
      });
    const request = {
      selectionAnchors: [
        {
          attachmentIndex: 2,
          startAnchor: "Hello",
          endInclusiveAnchor: "Hello",
        },
      ],
    };
    expect(
      (await context("A").createSearchHighlightAnnotations(request))
        .missingCount,
    ).toBe(1);
    expect(
      (await context("B").createSearchHighlightAnnotations(request))
        .createdCount,
    ).toBe(1);
    expect(documents.get("A")!.store.getState().annotations).toHaveLength(0);
    let resolve!: (result: typeof geometry) => void;
    resolveGeometry.mockReturnValueOnce(
      new Promise((finish) => {
        resolve = finish;
      }),
    );
    const abort = new AbortController();
    const pending = context("B").createSearchHighlightAnnotations({
      signal: abort.signal,
      selectionAnchors: [
        {
          attachmentIndex: 2,
          startAnchor: "world",
          endInclusiveAnchor: "world",
        },
      ],
    });
    abort.abort();
    resolve(geometry);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(documents.get("B")!.store.getState().annotations).toHaveLength(1);
  });

  it("keeps document identity on links even when control IDs collide", () => {
    expect(parseAiDocumentLinkHref("#control=shared&document=B")).toEqual({
      kind: "control",
      controlId: "shared",
      documentId: "B",
    });
    expect(parseAiDocumentLinkHref("#page=3&document=A")).toEqual({
      kind: "page",
      pageNumber: 3,
      documentId: "A",
    });
  });
});
