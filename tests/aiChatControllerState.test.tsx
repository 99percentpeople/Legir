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
import { useEditorStore } from "@/store/useEditorStore";
import { page } from "./helpers/editorStore";

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
let serial = 0;
const readState = () => selectAiChatEditorState(useEditorStore.getState());
function Harness({ scopeId }: { scopeId: string }) {
  const state = useEditorStore(useShallow(selectAiChatReactiveState));
  const reader = React.useMemo(
    () =>
      createAiChatSnapshotReader(
        readState,
        state.pdfBytes,
        () => activeScope === scopeId,
      ),
    [scopeId, state.pdfBytes],
  );
  controller = useAiChatController(state, scopeId, undefined, reader);
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
  vi.mocked(aiChatService.runConversation).mockReset();
  const initial = useEditorStore.getInitialState();
  useEditorStore.setState(
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
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("AI controller request ownership", () => {
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
