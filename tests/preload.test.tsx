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
    const fallbackMounted = vi.fn();
    function Fallback() {
      React.useLayoutEffect(fallbackMounted, []);
      return <div data-fallback>Loading</div>;
    }
    const loader = vi.fn(async () => ({
      default: ({ label }: { label: string }) => <div>{label}</div>,
    }));
    const Panel = preload(loader);

    await Panel.preload();
    await Panel.preload();

    await act(async () => {
      root.render(
        <React.Suspense fallback={<Fallback />}>
          <Panel label="Ready" />
        </React.Suspense>,
      );
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(fallbackMounted).not.toHaveBeenCalled();
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

  it("retries a failed background request when the component is actually opened", async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ default: () => <div>Recovered</div> });
    const Panel = preload(loader);
    await expect(Panel.preload()).rejects.toThrow("offline");

    await act(async () => {
      root.render(
        <React.Suspense fallback="Loading">
          <Panel />
        </React.Suspense>,
      );
    });

    expect(loader).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("Recovered");
  });

  it("does not mount components or run their effects during preload", async () => {
    const mounted = vi.fn();
    const Panel = preload(async () => ({
      default: function Panel() {
        React.useEffect(mounted, []);
        return <div>Panel</div>;
      },
    }));
    await Panel.preload();
    expect(mounted).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
    await act(async () => root.render(<Panel />));
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it("shares an in-flight preload with a render and concurrent intent requests", async () => {
    const pending = Promise.withResolvers<{ default: () => React.ReactNode }>();
    const loader = vi.fn(() => pending.promise);
    const Panel = preload(loader);
    const warming = Panel.preload();
    expect(Panel.preload()).toBe(warming);
    await act(async () =>
      root.render(
        <React.Suspense fallback="Loading">
          <Panel />
        </React.Suspense>,
      ),
    );
    expect(loader).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ default: () => <div>Ready</div> });
      await warming;
    });
    expect(container.textContent).toBe("Ready");
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
