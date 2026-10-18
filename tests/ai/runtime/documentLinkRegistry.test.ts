import { afterEach, expect, test, vi } from "vitest";
import { createAiDocumentLinkRegistry } from "@/app/ai/documentLinks";
import { createEditorTabRuntime } from "@/app/editorTabs/runtime";
import {
  createLoadedEditorTabSnapshot,
  getEditorTabSourceKey,
} from "@/app/editorTabs/storeSnapshot";
import type { EditorTabSession } from "@/app/editorTabs/types";
import type { AiDocumentLinkSource } from "@/app/ai/types";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import type { SaveTarget } from "@/services/platform/files";
import { page } from "../../helpers/editorStore";

const sessions = new Map<string, EditorTabSession>();
const created: EditorTabSession[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  created.splice(0).forEach((session) => session.runtime.dispose());
  sessions.clear();
  localStorage.clear();
});
const webTarget = (id = "file-a"): SaveTarget => ({
  kind: "web",
  id,
  handle: { name: "same.pdf" } as FileSystemFileHandle,
});
const add = (id: string, saveTarget: SaveTarget | null = webTarget()) => {
  const snapshot = createLoadedEditorTabSnapshot({
    pdfFile: null,
    pdfBytes: new Uint8Array([1]),
    pdfOpenPassword: null,
    documentPermissions: null,
    preservedSourceAnnotations: [],
    filename: "same.pdf",
    saveTarget,
    pages: [page()],
    fields: [],
    annotations: [],
    metadata: {},
    outline: [],
  });
  const session: EditorTabSession = {
    id,
    runtime: createEditorTabRuntime(snapshot, {}),
    windowId: "current",
    sourceKey: getEditorTabSourceKey(snapshot),
    lastActiveAt: "",
    workerService: {} as PDFWorkerService,
    disposePdfResources: null,
  };
  sessions.set(id, session);
  created.push(session);
  return session;
};
const close = (id: string) => {
  sessions.get(id)?.runtime.dispose();
  sessions.delete(id);
};
const registry = (
  openSource: (source: AiDocumentLinkSource) => Promise<void> = async () => {},
) =>
  createAiDocumentLinkRegistry({
    storage: localStorage,
    getSessions: () => [...sessions.values()],
    getDocument: (id) => {
      const session = sessions.get(id);
      return session
        ? {
            id,
            store: session.runtime.store,
            events: session.runtime.events,
            signal: session.runtime.signal,
            workerService: session.workerService,
            getRoot: () => null,
          }
        : null;
    },
    openSource,
  });

test("keeps PDF identity after closing, reopening and restoring without supporting old tab IDs", async () => {
  add("old-a");
  const first = registry();
  const linkId = first.getDocumentLinkId("old-a");
  expect(linkId).toMatch(/^d_[A-Za-z0-9_-]{12}$/);
  expect(encodeURIComponent(linkId)).toBe(linkId);
  close("old-a");
  add("new-a");
  add("same-name-other-file", webTarget("file-b"));
  const openSource = vi.fn(async () => {});
  const restored = registry(openSource);
  expect(restored.getDocumentLinkId("new-a")).toBe(linkId);
  expect(restored.getDocumentLinkId("same-name-other-file")).not.toBe(linkId);
  expect((await restored.openDocumentLink(linkId)).id).toBe("new-a");
  await expect(restored.openDocumentLink("old-a")).rejects.toThrow(
    "Unknown document link",
  );
  expect(openSource).not.toHaveBeenCalled();
});

test("retries a short ID collision without changing another PDF's saved binding", async () => {
  let draws = 0;
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    (array as Uint8Array).fill(draws++ < 2 ? 0 : 1);
    return array;
  });
  add("a", webTarget("file-a"));
  const firstId = registry().getDocumentLinkId("a");
  add("b", webTarget("file-b"));
  const restored = registry();
  const secondId = restored.getDocumentLinkId("b");
  expect(draws).toBe(3);
  expect(secondId).not.toBe(firstId);
  const final = registry();
  expect(final.getDocumentLinkId("a")).toBe(firstId);
  expect(final.getDocumentLinkId("b")).toBe(secondId);
  expect((await final.openDocumentLink(firstId)).id).toBe("a");
  expect((await final.openDocumentLink(secondId)).id).toBe("b");
});

test.each([
  webTarget(),
  { kind: "tauri", path: "/documents/a.pdf" } as SaveTarget,
])(
  "reopens the recorded source once and waits for hydration: %j",
  async (target) => {
    add("old", target);
    let ready: EditorTabSession | undefined;
    const openSource = vi.fn(async () => {
      ready = add("reopened", target);
      ready.runtime.store.setState({ documentLoadState: "hydrating" });
    });
    const links = registry(openSource);
    const id = links.getDocumentLinkId("old");
    close("old");
    add("unrelated", webTarget("other"));
    const completed = vi.fn();
    const first = links.openDocumentLink(id);
    const second = links.openDocumentLink(id);
    expect(first).toBe(second);
    void first.then(completed);
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    expect(openSource).toHaveBeenCalledExactlyOnceWith(
      target.kind === "web" ? { kind: "web", path: target.id } : target,
    );
    ready!.runtime.store.setState({ documentLoadState: "ready" });
    expect((await first).id).toBe("reopened");
  },
);

test("rejects stale handles and recovers after the user reopens the original file", async () => {
  add("old");
  const openSource = vi.fn(async () => {
    throw new DOMException("Access expired", "NotAllowedError");
  });
  const links = registry(openSource);
  const id = links.getDocumentLinkId("old");
  close("old");
  add("unrelated", webTarget("other"));
  await expect(links.openDocumentLink(id)).rejects.toThrow("Access expired");
  add("manually-reopened");
  expect((await links.openDocumentLink(id)).id).toBe("manually-reopened");
  expect(openSource).toHaveBeenCalledTimes(1);
});

test("Save As creates a new link identity without redirecting earlier links", async () => {
  const tab = add("tab", { kind: "tauri", path: "/original.pdf" });
  const openSource = vi.fn(async (source: AiDocumentLinkSource) => {
    if (source.kind === "tauri") add("original", source);
  });
  const links = registry(openSource);
  const original = links.getDocumentLinkId("tab");
  tab.runtime.store.setState({
    saveTarget: { kind: "tauri", path: "/copy.pdf" },
  });
  const copy = links.getDocumentLinkId("tab");
  expect(copy).not.toBe(original);
  expect((await links.openDocumentLink(copy)).id).toBe("tab");
  expect((await links.openDocumentLink(original)).id).toBe("original");
  await expect(links.openDocumentLink("tab")).rejects.toThrow(
    "Unknown document link",
  );
  expect(openSource).toHaveBeenCalledExactlyOnceWith({
    kind: "tauri",
    path: "/original.pdf",
  });
});

test("never treats an unknown ID, missing binding or handle name as a file location", async () => {
  const target: SaveTarget = {
    kind: "web",
    handle: { name: "same.pdf" } as FileSystemFileHandle,
  };
  add("old", target);
  const openSource = vi.fn(async () => {});
  const links = registry(openSource);
  const id = links.getDocumentLinkId("old");
  close("old");
  add("same-name", target);
  for (const unknown of [id, undefined, "/private.pdf", "web-file:made-up"]) {
    await expect(links.openDocumentLink(unknown)).rejects.toThrow();
  }
  expect(openSource).not.toHaveBeenCalled();
});

test("stops waiting when the target closes during hydration", async () => {
  const tab = add("loading");
  tab.runtime.store.setState({ documentLoadState: "hydrating" });
  const links = registry();
  const result = links.openDocumentLink(links.getDocumentLinkId("loading"));
  const rejected = expect(result).rejects.toThrow("Document unavailable");
  close("loading");
  await rejected;
});
