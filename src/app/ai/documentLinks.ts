import type { EditorTabSession } from "@/app/editorTabs/types";
import type { AiWorkspaceDocument } from "@/services/ai/chat/workspace";
import { createShortId } from "@/utils/createShortId";
import type { AiDocumentLinkBinding, AiDocumentLinkSource } from "./types";

const STORAGE_KEY = "app-ai-document-links:v1";

const getSource = (session: EditorTabSession) => {
  const state = session.runtime.store.getState();
  const target = state.saveTarget;
  let source: AiDocumentLinkSource | undefined;
  if (target?.kind === "tauri") source = { kind: "tauri", path: target.path };
  if (target?.kind === "web" && target.id)
    source = { kind: "web", path: target.id };
  // A handle name alone cannot distinguish files from different directories.
  const sourceKey = source
    ? `${source.kind === "web" ? "web-file" : "tauri"}:${source.path}`
    : state.pdfFile && !target
      ? session.sourceKey
      : null;
  return {
    sourceKey: sourceKey || `session:${session.id}`,
    filename: state.filename,
    source,
  };
};

const isBinding = (value: unknown): value is AiDocumentLinkBinding => {
  if (!value || typeof value !== "object") return false;
  const binding = value as AiDocumentLinkBinding;
  return (
    typeof binding.id === "string" &&
    /^d_[A-Za-z0-9_-]{12}$/.test(binding.id) &&
    typeof binding.sourceKey === "string" &&
    typeof binding.filename === "string" &&
    (!binding.source ||
      ((binding.source.kind === "web" || binding.source.kind === "tauri") &&
        typeof binding.source.path === "string" &&
        !!binding.source.path &&
        binding.sourceKey ===
          `${binding.source.kind === "web" ? "web-file" : "tauri"}:${binding.source.path}`))
  );
};

/** Links outlive tab runtimes. Only saved bindings may reopen a file; model
 * supplied IDs are never interpreted as filesystem paths or browser handles.
 */
export const createAiDocumentLinkRegistry = (options: {
  storage: Pick<Storage, "getItem" | "setItem">;
  getSessions: () => EditorTabSession[];
  getDocument: (id: string) => AiWorkspaceDocument | null;
  openSource: (source: AiDocumentLinkSource) => Promise<void>;
}) => {
  let bindings: AiDocumentLinkBinding[] = [];
  try {
    const saved: unknown = JSON.parse(
      options.storage.getItem(STORAGE_KEY) || "[]",
    );
    if (Array.isArray(saved)) bindings = saved.filter(isBinding);
  } catch {
    // A corrupt/unavailable cache must not prevent opening the application.
  }
  const save = () => {
    try {
      options.storage.setItem(STORAGE_KEY, JSON.stringify(bindings));
    } catch {
      // Retain bindings for this window when persistent storage is unavailable.
    }
  };
  const getDocumentLinkId = (documentId: string) => {
    if (bindings.some((binding) => binding.id === documentId))
      return documentId;
    const session = options
      .getSessions()
      .find((item) => item.id === documentId);
    if (!session) {
      return documentId;
    }
    const source = getSource(session);
    let binding = bindings.find((item) => item.sourceKey === source.sourceKey);
    if (!binding) {
      let id = createShortId("d");
      while (bindings.some((item) => item.id === id)) id = createShortId("d");
      binding = { ...source, id };
      bindings.push(binding);
      save();
    }
    return binding.id;
  };
  const pending = new Map<string, Promise<AiWorkspaceDocument>>();
  const openDocumentLink = (
    documentId?: string,
  ): Promise<AiWorkspaceDocument> => {
    const binding = bindings.find((item) => item.id === documentId);
    if (!binding) return Promise.reject(new Error("Unknown document link"));
    const target = binding;
    const existing = pending.get(binding.id);
    if (existing) return existing;
    const task = (async () => {
      const findSession = () =>
        options
          .getSessions()
          .find(
            (session) =>
              !session.runtime.disposed &&
              getSource(session).sourceKey === target.sourceKey,
          );
      let session = findSession();
      if (!session && target.source) {
        await options.openSource(target.source);
        session = findSession();
      }
      const document = session && options.getDocument(session.id);
      if (!document || document.signal.aborted)
        throw new Error("Document unavailable");
      await waitForDocumentReady(document);
      return document;
    })();
    pending.set(binding.id, task);
    void task.finally(() => pending.delete(target.id)).catch(() => {});
    return task;
  };
  return { getDocumentLinkId, openDocumentLink };
};

const waitForDocumentReady = (document: AiWorkspaceDocument) =>
  new Promise<void>((resolve, reject) => {
    let unsubscribe = () => {};
    const cleanup = () => {
      unsubscribe();
      document.signal.removeEventListener("abort", check);
    };
    const check = () => {
      const state = document.store.getState();
      if (document.signal.aborted || state.documentLoadState === "error") {
        cleanup();
        reject(new Error("Document unavailable"));
      } else if (state.documentLoadState === "ready") {
        cleanup();
        resolve();
      }
    };
    unsubscribe = document.store.subscribe(check);
    document.signal.addEventListener("abort", check, { once: true });
    check();
  });
