import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preload } from "@/utils/preload";

describe("preload", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shares one loader request between preload and React.lazy render", async () => {
    const loader = vi.fn(async () => ({
      default: ({ label }: { label: string }) => <div>{label}</div>,
    }));
    const Panel = preload(loader);

    await Panel.preload();
    await Panel.preload();

    await act(async () => {
      root.render(
        <React.Suspense fallback={<div data-fallback>Loading</div>}>
          <Panel label="Ready" />
        </React.Suspense>,
      );
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-fallback]")).toBeNull();
    expect(container.textContent).toBe("Ready");
  });

  it("supports mapping a named export into React.lazy's default shape", async () => {
    const NamedPanel = ({ value }: { value: number }) => <span>{value}</span>;
    const Panel = preload(async () => ({ default: NamedPanel }));

    await Panel.preload();
    await act(async () => {
      root.render(<Panel value={42} />);
    });

    expect(container.textContent).toBe("42");
  });
});
