import { afterEach, describe, expect, it, vi } from "vitest";

const metrics = vi.hoisted(() => ({
  aiLoads: 0,
  translateLoads: 0,
}));

vi.mock("@/pages/EditorPage/EditorAiRightPanel", () => {
  metrics.aiLoads += 1;
  return { default: () => null };
});

vi.mock("@/pages/EditorPage/EditorPageTranslateRightPanel", () => {
  metrics.translateLoads += 1;
  return { default: () => null };
});

import { scheduleEditorRightPanelBranchPreload } from "@/pages/EditorPage/rightPanelModules";

describe("right-panel deferred preload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("warms split tab modules only after the browser becomes idle", async () => {
    let idleCallback: (() => void) | undefined;
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: () => void) => {
        idleCallback = callback;
        return 17;
      }),
    );
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);

    const cancel = scheduleEditorRightPanelBranchPreload();

    expect(metrics.aiLoads).toBe(0);
    expect(metrics.translateLoads).toBe(0);

    idleCallback?.();
    await vi.dynamicImportSettled();

    expect(metrics.aiLoads).toBe(1);
    expect(metrics.translateLoads).toBe(1);

    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(17);
  });

  it("does not start preload after the scheduled work is cancelled", () => {
    let idleCallback: (() => void) | undefined;
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: () => void) => {
        idleCallback = callback;
        return 23;
      }),
    );
    vi.stubGlobal("cancelIdleCallback", vi.fn());

    const cancel = scheduleEditorRightPanelBranchPreload();
    cancel();
    idleCallback?.();

    expect(metrics.aiLoads).toBe(1);
    expect(metrics.translateLoads).toBe(1);
  });
});
