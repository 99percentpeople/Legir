import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShallow } from "zustand/react/shallow";
import { useAiChatController } from "@/hooks/useAiChatController";
import { createAiChatSnapshotReader } from "@/hooks/useAiChatController/editorSnapshot";
import { aiChatService } from "@/services/ai/chat/aiChatService";
import {
  selectAiChatEditorState,
  selectAiChatReactiveState,
} from "@/store/selectors";
import {
  useEditorView,
  activateEditorView,
  createDocumentEditorView,
} from "@/store/useEditorView";
import type { AiWorkspace } from "@/services/ai/chat/workspace";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { EventBus, type AppEventMap } from "@/lib/eventBus";
import { page } from "./helpers/editorStore";
import { GlobalAiProvider, useGlobalAi } from "@/app/ai/GlobalAiContext";

// Exercise the real controller/session state. Only model discovery and the
// provider transport are mocked; deferred requests deliberately ignore abort.
vi.mock("@/services/ai", () => ({
  getChatModelGroups: () => [
    {
      providerId: "test-provider",
      label: "Test provider",
      isAvailable: true,
      models: [
        {
          id: "test-model",
          label: "Test model",
          capabilities: {
            supportsToolCalls: true,
            supportsImageInput: false,
            supportsImageToolResults: false,
          },
        },
      ],
    },
  ],
  getVisionModelGroups: () => [],
  subscribeLLMModelRegistry: () => () => {},
  parseAiSdkModelSpecifier: () => null,
  getConfiguredAiSdkProvider: () => null,
  getAiRuntimeAdapter: vi.fn(),
  getReasoningLevelControl: vi.fn(),
  summarizePageImages: vi.fn(),
  summarizeConversationMemory: vi.fn(),
}));
vi.mock("@/services/ai/chat/aiChatService", () => ({
  aiChatService: { runConversation: vi.fn() },
}));

type RunResult = Awaited<ReturnType<typeof aiChatService.runConversation>>;
const deferred = () => {
  let resolve!: (value: RunResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<RunResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const usage = {
  tokenUsage: {
    inputTokens: 900,
    outputTokens: 100,
    totalTokens: 1000,
    reasoningTokens: 0,
    cachedInputTokens: 0,
  },
  contextTokens: 900,
  contextTokenOverhead: 0,
  stepNumber: 1,
};
let controller: ReturnType<typeof useAiChatController>;
let root: Root;
let node: HTMLDivElement;
let activeScope: string;
let workspace: AiWorkspace | undefined;
let serial = 0;
const readState = () => selectAiChatEditorState(useEditorView.getState());
function Harness({ scopeId }: { scopeId: string }) {
  const state = useEditorView(useShallow(selectAiChatReactiveState));
  const reader = React.useMemo(
    () =>
      createAiChatSnapshotReader(
        readState,
        state.pdfBytes,
        () => activeScope === scopeId,
      ),
    [scopeId, state.pdfBytes],
  );
  controller = useAiChatController(
    state,
    workspace ? `workspace-${serial}` : scopeId,
    undefined,
    workspace ? readState : reader,
    workspace,
  );
  return null;
}
const render = async () => {
  await act(async () => root.render(<Harness scopeId={activeScope} />));
};
const send = async (text: string) => {
  const transport = deferred();
  vi.mocked(aiChatService.runConversation).mockReturnValueOnce(
    transport.promise,
  );
  let completion!: Promise<void>;
  await act(async () => {
    completion = controller.sendMessage({ text });
  });
  expect(controller.runStatus).toBe("running");
  const request = vi
    .mocked(aiChatService.runConversation)
    .mock.calls.at(-1)![0];
  return { transport, completion, request };
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  workspace = undefined;
  activateEditorView();
  vi.mocked(aiChatService.runConversation).mockReset();
  const initial = useEditorView.getInitialState();
  useEditorView.setState(
    {
      ...initial,
      documentLoadState: "ready",
      pdfBytes: new Uint8Array([1]),
      filename: `test-${++serial}.pdf`,
      pages: [page()],
      options: {
        ...initial.options,
        aiChat: { ...initial.options.aiChat, contextCompressionEnabled: false },
      },
    },
    true,
  );
  activeScope = `scope-${serial}-A`;
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  await render();
  await act(async () =>
    controller.setSelectedModelKey("test-provider:test-model"),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  activateEditorView();
  useEditorView.setState(useEditorView.getInitialState(), true);
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("AI controller request ownership", () => {
  it("retains a unified conversation and keeps a turn bound to A while the user switches to B", async () => {
    const base = { pages: [page()], documentLoadState: "ready" as const };
    const a = createDocumentEditorView({
      ...base,
      filename: "A.pdf",
      pdfBytes: new Uint8Array([1]),
    });
    const b = createDocumentEditorView({
      ...base,
      filename: "B.pdf",
      pdfBytes: new Uint8Array([2]),
    });
    let activeId = "A";
    const docs = new Map([
      ["A", a.store],
      ["B", b.store],
    ]);
    const lifetime = new AbortController();
    workspace = {
      getActiveDocumentId: () => activeId,
      listDocuments: () =>
        [...docs].map(([id, store]) => ({
          documentId: id,
          filename: store.getState().filename,
          pageCount: 1,
          isActive: activeId === id,
          isDirty: false,
          loadState: "ready",
        })),
      getDocument: (id) => {
        const store = docs.get(id);
        return store
          ? {
              id,
              store,
              workerService: {} as PDFWorkerService,
              events: new EventBus(),
              signal: lifetime.signal,
              getRoot: () => null,
            }
          : null;
      },
      activateDocument: () => true,
    };
    try {
      await act(async () => activateEditorView(a.store));
      await render();
      const running = await send("Compare the open documents");
      const sessionId = controller.activeSessionId;
      await act(async () => {
        activeId = "B";
        activateEditorView(b.store);
      });
      await render();
      expect(running.request.signal?.aborted).toBe(false);
      expect(controller.activeSessionId).toBe(sessionId);
      expect(controller.runStatus).toBe("running");
      const listing = await running.request.toolRegistry.execute(
        "list_open_documents",
        {},
      );
      expect(listing.payload).toMatchObject({
        activeDocumentId: "B",
        defaultDocumentId: "A",
      });
      const fromA = await running.request.toolRegistry.execute(
        "get_document_metadata",
        { args: {} },
      );
      const fromB = await running.request.toolRegistry.execute(
        "get_document_metadata",
        { document_id: "B", args: {} },
      );
      expect(JSON.stringify(fromA.payload)).toContain("A.pdf");
      expect(JSON.stringify(fromB.payload)).toContain("B.pdf");
      await act(async () => {
        running.request.onUsageUpdate?.(usage);
        running.transport.resolve({
          turnId: "workspace-turn",
          conversation: [],
          assistantMessage: "Done",
          awaitingContinue: false,
          tokenUsage: usage.tokenUsage,
          contextTokens: usage.contextTokens,
          contextTokenOverhead: 0,
        });
        await running.completion;
      });
      expect(controller.runStatus).toBe("idle");
      expect(
        controller.timeline.some(
          (item) =>
            item.kind === "message" &&
            item.text === "Compare the open documents",
        ),
      ).toBe(true);
      await act(async () => {
        activeId = "A";
        activateEditorView(a.store);
      });
      expect(controller.activeSessionId).toBe(sessionId);
    } finally {
      await act(async () => {
        activateEditorView();
        a.dispose();
        b.dispose();
      });
    }
  });

  it("keeps the real window-level host and composer alive after its panel and last document close", async () => {
    let shared: NonNullable<ReturnType<typeof useGlobalAi>>;
    const lifetime = new AbortController();
    const documentStore = createDocumentEditorView({
      filename: "A.pdf",
      pages: [page()],
      documentLoadState: "ready",
      pdfBytes: new Uint8Array([1]),
    });
    let open = true;
    const events = new EventBus<AppEventMap>();
    const globalWorkspace: AiWorkspace = {
      getActiveDocumentId: () => (open ? "A" : null),
      listDocuments: () => [],
      getDocument: (id) =>
        open && id === "A"
          ? {
              id,
              store: documentStore.store,
              signal: lifetime.signal,
              events,
              workerService: {} as PDFWorkerService,
              getRoot: () => null,
            }
          : null,
      activateDocument: () => open,
    };
    function Panel() {
      const state = useGlobalAi()!;
      shared = state;
      React.useEffect(state.requestController, [state.requestController]);
      if (state.controller) controller = state.controller;
      return <span>{state.draft}</span>;
    }
    const showPanel = async (show: boolean) =>
      act(async () => {
        root.render(
          <GlobalAiProvider workspace={globalWorkspace}>
            {show && <Panel />}
          </GlobalAiProvider>,
        );
        await import("@/app/ai/GlobalAiControllerHost");
      });
    try {
      await act(async () => activateEditorView(documentStore.store));
      await showPanel(true);
      expect(shared!.controller).not.toBeNull();
      await act(async () =>
        controller.setSelectedModelKey("test-provider:test-model"),
      );
      await act(async () => shared!.setDraft("Kept across panels"));
      const running = await send("Keep running without a panel");
      const sessionId = controller.activeSessionId;
      await showPanel(false);
      await act(async () => {
        open = false;
        lifetime.abort();
        activateEditorView();
        useEditorView.setState({
          documentLoadState: "ready",
          pages: [],
          pdfBytes: null,
        });
      });
      expect(running.request.signal?.aborted).toBe(false);
      expect(
        (
          await running.request.toolRegistry.execute("get_document_metadata", {
            args: {},
          })
        ).payload,
      ).toMatchObject({ error: "DOCUMENT_CLOSED" });
      await act(async () => {
        running.transport.resolve({
          turnId: "background-turn",
          conversation: [],
          assistantMessage: "Done",
          awaitingContinue: false,
          tokenUsage: usage.tokenUsage,
          contextTokens: usage.contextTokens,
          contextTokenOverhead: 0,
        });
        await running.completion;
      });
      await showPanel(true);
      expect(shared!.draft).toBe("Kept across panels");
      expect(controller.activeSessionId).toBe(sessionId);
      expect(controller.runStatus).toBe("idle");
      expect(
        controller.timeline.some(
          (item) =>
            item.kind === "message" &&
            item.text === "Keep running without a panel",
        ),
      ).toBe(true);
    } finally {
      await act(async () => {
        activateEditorView();
        documentStore.dispose();
      });
    }
  });

  it("ignores late usage/errors after a document switch and keeps the new request cancellable", async () => {
    const old = await send("Question in A");
    activeScope = `scope-${serial}-B`;
    await render();
    expect(old.request.signal?.aborted).toBe(true);
    const current = await send("Question in B");
    const before = controller.timeline;
    const currentUsage = controller.tokenUsage;
    await act(async () => {
      old.request.onUsageUpdate?.(usage);
      old.transport.reject(new Error("Late failure from A"));
      await old.completion;
    });
    expect(controller.timeline).toBe(before);
    expect(controller.tokenUsage).toBe(currentUsage);
    expect(controller.lastError).toBeNull();
    expect(controller.runStatus).toBe("running");
    await act(async () => controller.stop());
    expect(current.request.signal?.aborted).toBe(true);
    await act(async () => {
      current.transport.reject(new DOMException("Stopped", "AbortError"));
      await current.completion;
    });
    expect(controller.runStatus).toBe("idle");
    expect(controller.lastError).toBeNull();
    activeScope = `scope-${serial}-A`;
    await render();
    expect(controller.runStatus).toBe("idle");
    expect(
      controller.timeline.some(
        (item) => item.kind === "message" && item.text === "Question in A",
      ),
    ).toBe(true);
  });

  it("does not revive a cleared conversation when an old request resolves successfully", async () => {
    const old = await send("Discard this conversation");
    await act(async () => controller.clearConversation());
    const current = await send("Keep this conversation");
    const before = controller.timeline;
    await act(async () => {
      old.transport.resolve({
        turnId: "old-turn",
        conversation: [],
        assistantMessage: "Late answer",
        awaitingContinue: false,
        tokenUsage: usage.tokenUsage,
        contextTokens: usage.contextTokens,
        contextTokenOverhead: 0,
      });
      await old.completion;
    });
    expect(controller.timeline).toBe(before);
    expect(controller.runStatus).toBe("running");
    expect(controller.lastError).toBeNull();
    await act(async () => controller.stop());
    expect(current.request.signal?.aborted).toBe(true);
    await act(async () => {
      current.transport.reject(new DOMException("Stopped", "AbortError"));
      await current.completion;
    });
    expect(controller.runStatus).toBe("idle");
  });

  it("accepts live usage but drops post-cancellation callbacks", async () => {
    const current = await send("Question");
    await act(async () => current.request.onUsageUpdate?.(usage));
    expect(controller.tokenUsage.totalTokens).toBe(1000);
    await act(async () => controller.stop());
    const before = controller.tokenUsage;
    await act(async () => current.request.onUsageUpdate?.(usage));
    expect(controller.tokenUsage).toBe(before);
    await act(async () => {
      current.transport.reject(new DOMException("Stopped", "AbortError"));
      await current.completion;
    });
    expect(controller.runStatus).toBe("idle");
  });
});
