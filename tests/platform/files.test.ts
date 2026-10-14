// @vitest-environment node
import { Buffer } from "node:buffer";
import { expect, it, vi } from "vitest";
import { writeToSaveTarget } from "@/services/platform/files";
const fs = vi.hoisted(() => ({ open: vi.fn(), writeFile: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => fs);

it("writes desktop Blobs in bounded chunks, including partial writes", async () => {
  const parts: Uint8Array[] = [];
  const close = vi.fn();
  fs.open.mockResolvedValue({
    close,
    write: async (bytes: Uint8Array) => {
      expect(bytes.length).toBeLessThanOrEqual(4 * 1024 * 1024);
      const length = Math.min(700_000, bytes.length);
      parts.push(bytes.slice(0, length));
      return length;
    },
  });
  const input = new Uint8Array(5 * 1024 * 1024 + 17).fill(13);
  input[input.length - 1] = 99;
  await writeToSaveTarget(
    { kind: "tauri", path: "/document.pdf" },
    new Blob([input]),
  );
  expect(
    Buffer.from(await new Blob(parts as BlobPart[]).arrayBuffer()).equals(
      Buffer.from(input),
    ),
  ).toBe(true);
  expect(close).toHaveBeenCalledOnce();
  expect(fs.writeFile).not.toHaveBeenCalled();
});

it("retains the existing desktop save capability when opening a restored target is disallowed", async () => {
  fs.open.mockRejectedValue(new Error("forbidden path for allow-open"));
  fs.writeFile.mockResolvedValue(undefined);
  await writeToSaveTarget(
    { kind: "tauri", path: "/restored.pdf" },
    new Blob(["pdf"]),
  );
  expect(fs.writeFile).toHaveBeenLastCalledWith(
    "/restored.pdf",
    new TextEncoder().encode("pdf"),
  );
});

it("passes Blob output directly to the browser sink and aborts failed writes", async () => {
  const blob = new Blob(["pdf output"], { type: "application/pdf" });
  const write = vi.fn().mockRejectedValue(new Error("Disk full"));
  const close = vi.fn(),
    abort = vi.fn().mockResolvedValue(undefined);
  const target = {
    kind: "web" as const,
    handle: {
      createWritable: async () => ({ write, close, abort }),
    } as unknown as FileSystemFileHandle,
  };
  await expect(writeToSaveTarget(target, blob)).rejects.toThrow("Disk full");
  expect(write).toHaveBeenCalledWith(blob);
  expect(abort).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
});

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
