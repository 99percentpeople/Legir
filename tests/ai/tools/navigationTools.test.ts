import { describe, expect, test, vi } from "vitest";
import { createAiToolRegistry } from "@/services/ai/chat/aiToolRegistry";
import type { AiToolContext } from "@/services/ai/chat/aiToolContext";

const setup = () => {
  const ctx = {
    getDocumentContext: () => ({ pageCount: 3 }),
    navigatePage: vi.fn(),
    focusControl: vi.fn((id: string) =>
      id === "field" ? { controlType: "field", pageNumber: 2 } : null,
    ),
    getStoredSearchResult: vi.fn((id: string) =>
      id === "hit" ? { result: { pageIndex: 2 } } : null,
    ),
    focusSearchResult: vi.fn(async () => {}),
  };
  return {
    ctx,
    registry: createAiToolRegistry(ctx as unknown as AiToolContext),
  };
};

describe("unified navigation", () => {
  test("navigates to page, control and search hit using the correct target", async () => {
    const { ctx, registry } = setup();
    await registry.execute("navigate", {
      target: { type: "page", page_number: 2 },
    });
    expect(ctx.navigatePage).toHaveBeenCalledExactlyOnceWith(1);
    const control = await registry.execute("navigate", {
      target: { type: "control", control_id: "field" },
    });
    expect(control.payload).toMatchObject({
      ok: true,
      pageNumber: 2,
      selected: false,
    });
    expect(ctx.focusControl).toHaveBeenCalledExactlyOnceWith("field", {
      select: false,
    });
    const signal = new AbortController().signal;
    const result = await registry.execute(
      "navigate",
      { target: { type: "result", result_id: "hit" } },
      signal,
    );
    expect(result.payload).toMatchObject({
      ok: true,
      pageNumber: 3,
      resultId: "hit",
    });
    expect(ctx.focusSearchResult).toHaveBeenCalledExactlyOnceWith(
      { pageIndex: 2 },
      signal,
    );
  });

  test("rejects ambiguous, missing, out-of-range and stale targets", async () => {
    const { ctx, registry } = setup();
    for (const target of [
      { type: "page", page_number: 1, control_id: "field" },
      { type: "page" },
      { type: "control", control_id: " " },
    ]) {
      expect(
        (await registry.execute("navigate", { target })).payload,
      ).toMatchObject({ error: "INVALID_ARGUMENTS" });
    }
    expect(
      (
        await registry.execute("navigate", {
          target: { type: "page", page_number: 4 },
        })
      ).payload,
    ).toMatchObject({ error: "INVALID_PAGE" });
    expect(
      (
        await registry.execute("navigate", {
          target: { type: "control", control_id: "gone" },
        })
      ).payload,
    ).toMatchObject({ error: "CONTROL_NOT_FOUND" });
    expect(
      (
        await registry.execute("navigate", {
          target: { type: "result", result_id: "gone" },
        })
      ).payload,
    ).toMatchObject({ error: "RESULT_NOT_FOUND" });
    expect(ctx.navigatePage).not.toHaveBeenCalled();
    expect(ctx.focusSearchResult).not.toHaveBeenCalled();
  });
});
