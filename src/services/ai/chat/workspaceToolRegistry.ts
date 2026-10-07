import { z } from "zod";
import type { AiChatToolDefinition, AiToolRegistry } from "./types";
import type { AiWorkspace } from "./workspace";
import { normalizeAiToolArgsDeep } from "@/services/ai/utils/toolCase";

const scopeLinks = (value: unknown, documentId: string): unknown => {
  if (
    typeof value === "string" &&
    /^#(?:page|control|result)=/.test(value) &&
    !value.includes("&document=")
  ) {
    return `${value}&document=${encodeURIComponent(documentId)}`;
  }
  if (Array.isArray(value))
    return value.map((item) => scopeLinks(item, documentId));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        scopeLinks(item, documentId),
      ]),
    );
  return value;
};

/** One registry per AI turn. The default document is pinned at turn start;
 * explicit document_id allows concurrent operations on any open document.
 */
export const createWorkspaceAiToolRegistry = (options: {
  workspace: AiWorkspace;
  defaultDocumentId: string | null;
  definitions: AiChatToolDefinition[];
  createRegistry: (documentId: string) => AiToolRegistry;
}): AiToolRegistry => {
  const { workspace, defaultDocumentId } = options;
  const definitions: AiChatToolDefinition[] = [
    {
      name: "list_open_documents",
      accessType: "read",
      description:
        "List every open document in this workspace, its stable document_id, filename, loading/dirty state, and the document the user is currently viewing. Call this before cross-document work or when the user refers to the current document.",
      inputSchema: z.object({}).strict(),
      promptInstructions: [
        "Conversations span all open documents. Use list_open_documents to find document IDs. All document tools accept {document_id, args}. Omitted document_id is pinned to the document active when this user turn started, not the tab currently visible. Always specify document_id for cross-document work and keep it fixed throughout a document operation. Preserve document= in returned navigation links.",
      ],
    },
    ...options.definitions.map((definition) => ({
      ...definition,
      inputSchema: z
        .object({
          document_id: z
            .string()
            .min(1)
            .optional()
            .describe(
              "Stable ID from list_open_documents. Defaults to the document active at the beginning of this turn.",
            ),
          args: definition.inputSchema.describe(
            "Arguments for this document tool.",
          ),
        })
        .strict(),
      ...(definition.toModelOutput
        ? {
            toModelOutput: (
              input: Parameters<
                NonNullable<AiChatToolDefinition["toModelOutput"]>
              >[0],
            ) =>
              definition.toModelOutput!({
                ...input,
                input: (input.input as { args?: unknown })?.args,
              }),
          }
        : {}),
    })),
  ];
  const registries = new Map<string, AiToolRegistry>();
  const failure = (code: string, message: string) => ({
    payload: { ok: false, error: code, message },
    summary: message,
  });
  return {
    getDefinitions: () => definitions,
    execute: async (name, rawArgs, signal, onProgress) => {
      if (signal?.aborted)
        throw signal.reason ?? new DOMException("Aborted", "AbortError");
      if (name === "list_open_documents") {
        return {
          payload: {
            activeDocumentId: workspace.getActiveDocumentId(),
            defaultDocumentId,
            documents: workspace.listDocuments(),
          },
          summary: "Listed open workspace documents.",
        };
      }
      if (!options.definitions.some((definition) => definition.name === name))
        return failure("UNKNOWN_TOOL", `Unknown tool: ${name}`);
      let parsed: unknown = rawArgs;
      if (typeof parsed === "string") {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          return failure(
            "INVALID_ARGUMENTS",
            "Expected a JSON object containing document_id and args.",
          );
        }
      }
      const record = normalizeAiToolArgsDeep(parsed) as {
        document_id?: unknown;
        args?: unknown;
      } | null;
      if (!record || typeof record !== "object" || Array.isArray(record))
        return failure("INVALID_ARGUMENTS", "Expected document_id and args.");
      if (
        record.document_id !== undefined &&
        (typeof record.document_id !== "string" || !record.document_id.trim())
      )
        return failure(
          "INVALID_ARGUMENTS",
          "document_id must be a non-empty string.",
        );
      const documentId =
        typeof record.document_id === "string"
          ? record.document_id
          : defaultDocumentId;
      if (!documentId)
        return failure(
          "NO_DOCUMENT",
          "No document was selected for this turn. Use list_open_documents and specify document_id.",
        );
      const document = workspace.getDocument(documentId);
      if (!document || document.signal.aborted)
        return failure(
          "DOCUMENT_CLOSED",
          `Document ${documentId} is no longer open. No operation was applied to another tab.`,
        );
      if (document.store.getState().documentLoadState !== "ready")
        return failure(
          "DOCUMENT_NOT_READY",
          `Document ${documentId} is not ready.`,
        );
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      document.signal.addEventListener("abort", abort, { once: true });
      try {
        let registry = registries.get(documentId);
        if (!registry) {
          registry = options.createRegistry(documentId);
          registries.set(documentId, registry);
        }
        if (["navigate_page", "focus_control", "focus_result"].includes(name))
          workspace.activateDocument(documentId);
        const result = await registry.execute(
          name,
          record.args ?? {},
          controller.signal,
          onProgress,
        );
        if (document.signal.aborted || !workspace.getDocument(documentId))
          return failure(
            "DOCUMENT_CLOSED",
            `Document ${documentId} was closed during the operation.`,
          );
        return {
          ...result,
          payload: {
            documentId,
            ...(scopeLinks(result.payload, documentId) as object),
          },
        };
      } catch (error) {
        if (document.signal.aborted)
          return failure(
            "DOCUMENT_CLOSED",
            `Document ${documentId} was closed during the operation.`,
          );
        throw error;
      } finally {
        signal?.removeEventListener("abort", abort);
        document.signal.removeEventListener("abort", abort);
      }
    },
  };
};
