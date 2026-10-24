// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { WorkerRequest } from "@/services/pdfService/workerProtocol";
import { getPDFium } from "@/services/pdfService/engine/runtime";

vi.mock("@/services/pdfService/engine/runtime", () => ({ getPDFium: vi.fn() }));
const surfaces: FakeCanvas[] = [];
const encode = vi.fn(async () => new Blob(["preview"], { type: "image/jpeg" }));
class FakeCanvas {
  drawImage = vi.fn();
  constructor(
    public width: number,
    public height: number,
  ) {
    surfaces.push(this);
  }
  getContext() {
    return { drawImage: this.drawImage };
  }
  convertToBlob() {
    return encode();
  }
}
type Reply = {
  id: string;
  success: boolean;
  payload?: { imageBytes: ArrayBuffer; mimeType: string } | boolean;
};
const pending = new Map<string, (reply: Reply) => void>();
const scope = {
  onmessage: (() => {}) as (event: { data: WorkerRequest }) => void,
  postMessage: (reply: Reply) => {
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  },
};
const channels: MessageChannel[] = [];
beforeAll(async () => {
  const NativeChannel = MessageChannel;
  vi.stubGlobal(
    "MessageChannel",
    class extends NativeChannel {
      constructor() {
        super();
        channels.push(this);
      }
    },
  );
  vi.stubGlobal("self", scope);
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
  await import("@/workers/pdf-render.worker");
});
afterAll(() => {
  for (const channel of channels) {
    channel.port1.close();
    channel.port2.close();
  }
  vi.unstubAllGlobals();
});
const send = (data: WorkerRequest) =>
  new Promise<Reply>((resolve) => {
    pending.set(data.id, resolve);
    scope.onmessage({ data });
  });
let sequence = 0;
async function registerCanvas() {
  const id = `canvas-${sequence++}`;
  const canvas = new FakeCanvas(2000, 3000);
  // Registration precedes rendering. No PDF is loaded: a preview must use this
  // retained surface even though attempting to rasterize would fail.
  await send({
    type: "render",
    id: `register-${id}`,
    canvasId: id,
    pageIndex: 0,
    scale: 1,
    canvas: canvas as unknown as OffscreenCanvas,
  });
  return { id, canvas };
}
const capture = (previewCanvasId: string) =>
  send({
    type: "renderImage",
    id: `preview-${sequence++}`,
    previewCanvasId,
    pageIndex: 0,
    targetWidth: 120,
  });

it("encodes a bounded copy of the completed canvas without loading or rendering a PDF", async () => {
  const { id, canvas } = await registerCanvas();
  const reply = await capture(id);
  expect(reply.success).toBe(true);
  expect(reply.payload).toMatchObject({
    mimeType: "image/jpeg",
    imageBytes: expect.any(ArrayBuffer),
  });
  const preview = surfaces.at(-1)!;
  expect(preview.drawImage).toHaveBeenCalledExactlyOnceWith(
    canvas,
    0,
    0,
    120,
    180,
  );
  expect([preview.width, preview.height]).toEqual([0, 0]);
  expect([canvas.width, canvas.height]).toEqual([2000, 3000]);
  expect(getPDFium).not.toHaveBeenCalled();
  await send({ type: "releaseCanvas", id: `release-${id}`, canvasIds: [id] });
});

it("does not recreate released canvases or fall back to native rendering", async () => {
  const before = surfaces.length;
  expect((await capture("missing")).payload).toBe(false);
  expect(surfaces).toHaveLength(before);
  expect(getPDFium).not.toHaveBeenCalled();
});

it.each(["cancel", "releaseCanvas"] as const)(
  "discards encoded bytes and frees the temporary surface after %s",
  async (action) => {
    const { id, canvas } = await registerCanvas();
    let finish!: (blob: Blob) => void;
    encode.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const requestId = `pending-${sequence++}`;
    const reply = send({
      type: "renderImage",
      id: requestId,
      previewCanvasId: id,
      pageIndex: 0,
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    if (action === "cancel")
      scope.onmessage({ data: { type: "cancel", id: requestId } });
    else
      await send({
        type: "releaseCanvas",
        id: `release-${id}`,
        canvasIds: [id],
      });
    finish(new Blob(["stale"], { type: "image/jpeg" }));
    expect((await reply).payload).toBe(false);
    const preview = surfaces.at(-1)!;
    expect([preview.width, preview.height]).toEqual([0, 0]);
    if (action === "cancel") {
      expect(canvas.width).toBe(2000);
      await send({
        type: "releaseCanvas",
        id: `release-${id}`,
        canvasIds: [id],
      });
    } else expect(canvas.width).toBe(0);
  },
);
