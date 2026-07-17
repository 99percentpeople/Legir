import { describe, expect, it, vi } from "vitest";

import { processPwaLaunchFiles } from "@/services/platform/browser/launch";

const createHandle = (name: string) =>
  ({
    kind: "file",
    name,
  }) as FileSystemFileHandle;

describe("PWA launch files", () => {
  it("continues opening later PDFs when one file fails", async () => {
    const handles = [
      createHandle("one.pdf"),
      createHandle("broken.pdf"),
      createHandle("three.pdf"),
    ];
    const opened: string[] = [];
    const onError = vi.fn();

    await processPwaLaunchFiles({
      handles,
      open: async (handle) => {
        if (handle.name === "broken.pdf") {
          throw new Error("failed to read file");
        }
        opened.push(handle.name);
      },
      onError,
    });

    expect(opened).toEqual(["one.pdf", "three.pdf"]);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[1]).toBe(handles[1]);
  });
});
