import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAiChatSessionData,
  persistAiChatDocumentState,
  restorePersistedAiChatDocumentState,
} from "@/hooks/useAiChatController/sessionPersistence";
import { restoreUnifiedAiChatState } from "@/hooks/useAiChatController/unifiedHistory";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
const writeHistory = (identity: string, ids: string[], updatedAt: string) => {
  const sessionsMap = new Map(
    ids.map((id) => {
      const session = createAiChatSessionData(id, updatedAt);
      session.title = id;
      return [id, session] as const;
    }),
  );
  persistAiChatDocumentState({
    documentIdentity: identity,
    activeSessionId: ids[0],
    sessions: [...sessionsMap.values()],
    sessionsMap,
  });
};

describe("unified AI history", () => {
  it("merges legacy document histories once, preserves their backups and keeps all imported conversations", () => {
    writeHistory(
      "A.pdf:1:10",
      Array.from({ length: 15 }, (_, i) => `A-${i}`),
      "2026-01-01T00:00:00.000Z",
    );
    writeHistory(
      "B.pdf:1:20",
      Array.from({ length: 15 }, (_, i) => `B-${i}`),
      "2026-01-02T00:00:00.000Z",
    );
    localStorage.setItem("app-ai-chat:broken", "invalid JSON");
    const restored = restoreUnifiedAiChatState()!;
    expect(restored.sessionsMap.size).toBe(30);
    expect(restored.activeSessionId).toBe("B-0");
    expect(localStorage.getItem("app-ai-chat:A.pdf:1:10")).not.toBeNull();
    expect(
      restorePersistedAiChatDocumentState("workspace")?.sessionsMap.size,
    ).toBe(30);
    // Once a unified history exists, deleted chats must not be resurrected from backups.
    writeHistory("workspace", ["kept"], "2026-01-03T00:00:00.000Z");
    expect([...restoreUnifiedAiChatState()!.sessionsMap.keys()]).toEqual([
      "kept",
    ]);
  });

  it("does not replace the last durable history with a single conversation on quota failure", () => {
    writeHistory("workspace", ["first", "second"], "2026-01-01T00:00:00.000Z");
    const previous = localStorage.getItem("app-ai-chat:workspace");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    writeHistory("workspace", ["new"], "2026-01-02T00:00:00.000Z");
    expect(localStorage.getItem("app-ai-chat:workspace")).toBe(previous);
  });
});
