import {
  canUseLocalStorage,
  persistAiChatDocumentState,
  restorePersistedAiChatDocumentState,
  type RestoredAiChatDocumentState,
} from "./sessionPersistence";

/** One history across documents. Import legacy per-document histories once,
 * retaining their source keys as a non-destructive backup.
 */
export const restoreUnifiedAiChatState =
  (): RestoredAiChatDocumentState | null => {
    if (!canUseLocalStorage()) return null;
    try {
      const unified = restorePersistedAiChatDocumentState("workspace");
      if (unified) return unified;
      const sessionsMap: RestoredAiChatDocumentState["sessionsMap"] = new Map();
      const summaries = new Map<
        string,
        RestoredAiChatDocumentState["sessionSummaries"][number]
      >();
      const prefix = "app-ai-chat:";
      for (let index = 0; index < window.localStorage.length; index++) {
        const key = window.localStorage.key(index);
        if (!key?.startsWith(prefix) || key === `${prefix}workspace`) continue;
        const previous = restorePersistedAiChatDocumentState(
          key.slice(prefix.length),
        );
        if (!previous) continue;
        for (const summary of previous.sessionSummaries) {
          const session = previous.sessionsMap.get(summary.id);
          if (!session) continue;
          const existing = summaries.get(summary.id);
          if (existing && existing.updatedAt >= summary.updatedAt) continue;
          // Legacy IDs must not silently redirect old search links to a new tab.
          for (const stored of session.searchResultsById.values()) {
            stored.documentId ??= `closed-legacy:${key.slice(prefix.length)}`;
          }
          sessionsMap.set(summary.id, session);
          summaries.set(summary.id, summary);
        }
      }
      const sessionSummaries = Array.from(summaries.values()).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
      if (!sessionSummaries.length) return null;
      const activeSessionId = sessionSummaries[0].id;
      persistAiChatDocumentState({
        documentIdentity: "workspace",
        activeSessionId,
        sessions: sessionSummaries,
        sessionsMap,
      });
      return { activeSessionId, sessionsMap, sessionSummaries };
    } catch {
      return null;
    }
  };
