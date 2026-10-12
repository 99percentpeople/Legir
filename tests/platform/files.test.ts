// @vitest-environment node
import { expect, it, vi } from "vitest";
import { writeToSaveTarget } from "@/services/platform/files";

it.each([false, true])(
  "writes only the byte view to the file target (shared: %s)",
  async (shared) => {
    const buffer = shared ? new SharedArrayBuffer(12) : new ArrayBuffer(12);
    const all = new Uint8Array(buffer);
    all.fill(99);
    all.set([1, 2, 3], 4);
    const bytes = all.subarray(4, 7);
    const write = vi.fn(async (chunk: Uint8Array) => {
      expect([...chunk]).toEqual([1, 2, 3]);
      if (shared) expect(chunk.buffer).not.toBe(buffer);
      else expect(chunk.buffer).toBe(buffer);
    });
    const close = vi.fn();
    await writeToSaveTarget(
      {
        kind: "web",
        handle: {
          createWritable: async () => ({ write, close }),
        } as unknown as FileSystemFileHandle,
      },
      bytes,
    );
    expect(write).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  },
);
