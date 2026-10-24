import { afterEach, expect, it, vi } from "vitest";
import { renderThumbnail } from "@/services/pdfService/thumbnailRenderer";
import { encodedImageDataUrl } from "@/utils/encodedImageDataUrl";

const bytes = new Uint8Array(100_007);
for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
const image = { bytes: bytes.subarray(3, 100_003), mimeType: "image/jpeg" };
afterEach(() => vi.unstubAllGlobals());

it.each(["image/jpeg", "image/png"])(
  "preserves %s bytes and subarray boundaries across encoding chunks",
  (mimeType) => {
    const url = encodedImageDataUrl(image.bytes, mimeType);
    expect(url.startsWith(`data:${mimeType};base64,`)).toBe(true);
    const decoded = Uint8Array.from(atob(url.split(",")[1]), (char) =>
      char.charCodeAt(0),
    );
    expect(decoded).toEqual(image.bytes);
  },
);

it("decodes a thumbnail before publishing without registering a Blob URL", async () => {
  const register = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: register });
  let finish!: () => void;
  let src = "";
  vi.stubGlobal(
    "Image",
    class {
      set src(value: string) {
        src = value;
      }
      decode() {
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      }
    },
  );
  const worker = { renderPageImage: vi.fn(async () => image) };
  const completed = vi.fn();
  const waiting = renderThumbnail(worker, 0, new AbortController().signal).then(
    completed,
  );
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(completed).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
  expect(src).toBe(encodedImageDataUrl(image.bytes, image.mimeType));
  finish();
  await waiting;
  expect(completed).toHaveBeenCalledExactlyOnceWith(src);
});

it("rejects a cancelled decode instead of publishing stale thumbnail bytes", async () => {
  let finish!: () => void;
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode() {
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      }
    },
  );
  const controller = new AbortController();
  const waiting = renderThumbnail(
    { renderPageImage: vi.fn(async () => image) },
    0,
    controller.signal,
  );
  const rejected = expect(waiting).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  controller.abort();
  finish();
  await rejected;
});
