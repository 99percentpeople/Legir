import { describe, expect, it } from "vitest";
import type {
  AiChatTimelineItem,
  AiChatMessageAttachment,
} from "@/services/ai/chat/types";
import {
  createDemoTokenPlan,
  estimateDemoTokens,
  getDemoTokenStats,
  simulateDemoTokenStats,
} from "../../www/src/components/workspace-demo/demoTokenUsage";
import type { DemoTokenStats } from "../../www/src/components/workspace-demo/types";

const snapshot = (stats: DemoTokenStats): AiChatTimelineItem => ({
  id: "assistant",
  kind: "message",
  role: "assistant",
  text: "An authored answer",
  createdAt: "2026-09-18T00:00:00Z",
  tokenUsageSnapshot: stats.tokenUsage,
  contextTokensSnapshot: stats.contextTokens,
});

const selection: AiChatMessageAttachment = {
  kind: "workspace_selection",
  text: "阅读也是思考。",
  pageIndex: 0,
  startOffset: 0,
  endOffset: 7,
  rect: { x: 0, y: 0, width: 1, height: 1 },
};

describe("local demo token accounting", () => {
  it("starts empty conversations at zero", () => {
    expect(getDemoTokenStats([])).toEqual({
      contextTokens: 0,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
      },
    });
  });

  it("uses deterministic, monotonic estimates for Latin, CJK and emoji", () => {
    expect(estimateDemoTokens("  ")).toBe(0);
    expect(estimateDemoTokens("abcd")).toBe(1);
    expect(estimateDemoTokens("阅读🙂")).toBe(3);
    const text = Array.from("A short answer. 阅读后再思考🙂");
    let previous = 0;
    for (let length = 0; length <= text.length; length += 1) {
      const tokens = estimateDemoTokens(text.slice(0, length).join(""));
      expect(tokens).toBeGreaterThanOrEqual(previous);
      expect(Number.isInteger(tokens)).toBe(true);
      previous = tokens;
    }
  });

  it("charges the input once while output follows visible text", () => {
    const plan = createDemoTokenPlan([], "abcd");
    expect(plan.inputTokens).toBe(1189);
    const start = simulateDemoTokenStats(plan, "");
    const partial = simulateDemoTokenStats(plan, "1234");
    const end = simulateDemoTokenStats(plan, "12345678");
    expect(start.tokenUsage.outputTokens).toBe(0);
    expect(partial.tokenUsage.outputTokens).toBe(1);
    expect(end.tokenUsage).toEqual({
      inputTokens: 1189,
      outputTokens: 2,
      totalTokens: 1191,
      reasoningTokens: 0,
      cachedInputTokens: 0,
    });
    expect(start.tokenUsage.inputTokens).toBe(end.tokenUsage.inputTokens);
    expect(end.contextTokens).toBe(1191);
    expect(simulateDemoTokenStats(plan, "1234")).toEqual(partial);
  });

  it("grows retained context separately from cumulative request totals", () => {
    const first = simulateDemoTokenStats(
      createDemoTokenPlan([], "abcd"),
      "12345678",
    );
    const prefix = [snapshot(first)];
    const plan = createDemoTokenPlan(prefix, "next");
    const second = simulateDemoTokenStats(plan, "More text");
    expect(plan.inputTokens).toBe(first.contextTokens + 8 + 1);
    expect(second.tokenUsage.inputTokens).toBe(
      first.tokenUsage.inputTokens + plan.inputTokens,
    );
    expect(second.tokenUsage.totalTokens).toBe(
      second.tokenUsage.inputTokens + second.tokenUsage.outputTokens,
    );
    expect(second.contextTokens).toBeLessThan(second.tokenUsage.totalTokens);
    expect(getDemoTokenStats(prefix)).toEqual(first);
  });

  it("includes attachment text without assuming every attachment has a text field", () => {
    const plain = createDemoTokenPlan([], "Explain");
    const attached = createDemoTokenPlan([], "Explain", [selection]);
    expect(attached.inputTokens).toBe(
      plain.inputTokens + 8 + estimateDemoTokens(selection.text),
    );
    expect(
      createDemoTokenPlan([], "Explain", [
        {
          kind: "annotation_reference",
          annotationId: "note",
          annotationType: "highlight",
          pageIndex: 0,
        },
      ]).inputTokens,
    ).toBe(plain.inputTokens + 8);
  });

  it("counts simulated reasoning as a subset of output, never twice", () => {
    const plain = simulateDemoTokenStats(
      createDemoTokenPlan([], "Explain"),
      "十二个字用于模拟思考统计",
    );
    const reasoning = simulateDemoTokenStats(
      createDemoTokenPlan([], "Explain", [], "auto"),
      "十二个字用于模拟思考统计",
    );
    expect(plain.tokenUsage.reasoningTokens).toBe(0);
    expect(reasoning.tokenUsage.reasoningTokens).toBeGreaterThan(0);
    expect(reasoning.tokenUsage.outputTokens).toBe(
      plain.tokenUsage.outputTokens + reasoning.tokenUsage.reasoningTokens,
    );
    expect(reasoning.tokenUsage.totalTokens).toBe(
      reasoning.tokenUsage.inputTokens + reasoning.tokenUsage.outputTokens,
    );
    expect(reasoning.contextTokens).toBe(plain.contextTokens);
  });

  it("restores saved statistics and replaces regenerated or edited branches", () => {
    const first = simulateDemoTokenStats(
      createDemoTokenPlan([], "First"),
      "First answer",
    );
    const prefix = [snapshot(first)];
    const run = () =>
      simulateDemoTokenStats(
        createDemoTokenPlan(prefix, "Next"),
        "Next answer",
      );
    const second = run();
    expect(run()).toEqual(second);
    expect(getDemoTokenStats([...prefix, snapshot(second)])).toEqual(second);
    expect(getDemoTokenStats(prefix)).toEqual(first);
    const edited = simulateDemoTokenStats(
      createDemoTokenPlan([], "Changed"),
      "New branch",
    );
    expect(getDemoTokenStats([snapshot(edited)])).toEqual(edited);
    expect(edited.tokenUsage.totalTokens).toBeLessThan(
      second.tokenUsage.totalTokens,
    );
  });
});
