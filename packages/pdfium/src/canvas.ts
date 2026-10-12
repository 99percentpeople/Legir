import type { PDFPage } from "./page.js";
import type { Matrix, Rect, RenderOptions } from "./types.js";

/** Experimental, owned display list. It remains valid after closing the PDF.
 * Unsupported PDF features reject the whole page; callers must use page.render.
 * Canvas antialiasing/JPEG downsampling can differ from PDFium's native output.
 */
export interface PDFCanvasPlan {
  commands: Float64Array;
  images: Uint8Array<ArrayBuffer>[];
  box: Rect;
}

function plainJpeg(bytes: Uint8Array) {
  if (bytes[0] !== 255 || bytes[1] !== 216) return false;
  // Browser EXIF orientation and embedded profiles can change PDF image semantics.
  // Reject metadata-bearing images rather than silently applying those changes.
  for (let offset = 2; offset + 3 < bytes.length; ) {
    if (bytes[offset++] !== 255) return false;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda) return true;
    if ([0xe1, 0xe2, 0xee, 0xd9].includes(marker)) return false;
    const size = bytes[offset] * 256 + bytes[offset + 1];
    if (size < 2 || offset + size > bytes.length) return false;
    offset += size;
  }
  return false;
}

export function createCanvasPlan(
  page: PDFPage,
  options: RenderOptions = {},
): PDFCanvasPlan | null {
  page.assertOpen();
  if (options.contents === false) return null;
  const object = page.getObject();
  try {
    const annots = object.get("Annots");
    try {
      if (
        (options.annotations !== false || options.keepAnnotations?.size) &&
        annots.length
      )
        return null;
    } finally {
      annots.destroy();
    }
  } finally {
    object.destroy();
  }
  const rt = page.document.runtime;
  const plan = rt.call("LPDF_CanvasPlan", page.pointer);
  if (!plan) return null;
  try {
    const pointer = rt.call("LPDF_CanvasCommands", plan);
    const count = rt.call("LPDF_CanvasCommandCount", plan);
    const commands = rt.native.HEAPF64.slice(pointer / 8, pointer / 8 + count);
    const images = Array.from(
      { length: rt.call("LPDF_CanvasImageCount", plan) },
      (_, i) => {
        const start = rt.call("LPDF_CanvasImageData", plan, i);
        const size = rt.call("LPDF_CanvasImageSize", plan, i);
        return rt.native.HEAPU8.slice(
          start,
          start + size,
        ) as Uint8Array<ArrayBuffer>;
      },
    );
    if (!images.every(plainJpeg)) return null;
    return { commands, images, box: page.geometry().box };
  } finally {
    rt.call("LPDF_CanvasPlanDrop", plan);
  }
}

type CanvasContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;
const rgb = (value: number) =>
  `rgb(${value & 255} ${(value >>> 8) & 255} ${(value >>> 16) & 255})`;

/** Draw atomically: cancelled/failed plans leave the destination unchanged.
 * This API is opt-in and is not the app's default renderer.
 */
export async function drawCanvasPlan(
  plan: PDFCanvasPlan,
  target: CanvasContext,
  matrix: Matrix,
  bounds: Rect,
  options: { signal?: AbortSignal; transparent?: boolean } = {},
) {
  const x = Math.floor(bounds[0]),
    y = Math.floor(bounds[1]);
  const width = Math.ceil(bounds[2]) - x,
    height = Math.ceil(bounds[3]) - y;
  if (
    !matrix.every(Number.isFinite) ||
    !bounds.every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    width * height > 64000000
  )
    throw new Error("Invalid Canvas render bounds.");
  options.signal?.throwIfAborted();
  const canvas = new OffscreenCanvas(width, height);
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is unavailable.");
    if (!options.transparent) {
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.setTransform(
      matrix[0],
      matrix[1],
      matrix[2],
      matrix[3],
      matrix[4] - x,
      matrix[5] - y,
    );
    ctx.beginPath();
    ctx.rect(
      plan.box[0],
      plan.box[1],
      plan.box[2] - plan.box[0],
      plan.box[3] - plan.box[1],
    );
    ctx.clip();
    const data = plan.commands;
    let n = 0,
      deadline = performance.now() + 8;
    while (n < data.length) {
      options.signal?.throwIfAborted();
      const type = data[n++];
      ctx.save();
      ctx.transform(
        data[n++],
        data[n++],
        data[n++],
        data[n++],
        data[n++],
        data[n++],
      );
      if (type === 1) {
        const fill = data[n++],
          stroke = data[n++];
        ctx.fillStyle = rgb(data[n++]);
        ctx.strokeStyle = rgb(data[n++]);
        ctx.lineWidth = data[n++];
        ctx.lineCap = (["butt", "round", "square"] as const)[data[n++]];
        ctx.lineJoin = (["miter", "round", "bevel"] as const)[data[n++]];
        ctx.miterLimit = data[n++];
        ctx.lineDashOffset = data[n++];
        const dashCount = data[n++];
        ctx.setLineDash(Array.from(data.subarray(n, n + dashCount)));
        n += dashCount;
        const end = n + 1 + data[n] * 4;
        n++;
        ctx.beginPath();
        while (n < end) {
          const kind = data[n],
            px = data[n + 1],
            py = data[n + 2];
          if (kind === 2) ctx.moveTo(px, py);
          else if (kind === 0) ctx.lineTo(px, py);
          else if (
            kind === 1 &&
            n + 11 < end &&
            data[n + 4] === 1 &&
            data[n + 8] === 1
          ) {
            ctx.bezierCurveTo(
              px,
              py,
              data[n + 5],
              data[n + 6],
              data[n + 9],
              data[n + 10],
            );
            n += 8;
          } else throw new Error("Invalid Canvas path.");
          if (data[n + 3]) ctx.closePath();
          n += 4;
        }
        if (fill) ctx.fill(fill === 2 ? "evenodd" : "nonzero");
        if (stroke) ctx.stroke();
      } else if (type === 2) {
        const index = data[n++],
          imageWidth = data[n++],
          imageHeight = data[n++];
        ctx.imageSmoothingEnabled = !!data[n++];
        const bitmap = await createImageBitmap(
          new Blob([plan.images[index]], { type: "image/jpeg" }),
          { imageOrientation: "none", colorSpaceConversion: "none" },
        );
        try {
          options.signal?.throwIfAborted();
          if (bitmap.width !== imageWidth || bitmap.height !== imageHeight)
            throw new Error(
              "JPEG dimensions differ from the PDF image dictionary.",
            );
          ctx.transform(1, 0, 0, -1, 0, 1);
          ctx.drawImage(bitmap, 0, 0, 1, 1);
        } finally {
          bitmap.close();
        }
      } else throw new Error("Invalid Canvas command.");
      ctx.restore();
      if (performance.now() >= deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        deadline = performance.now() + 8;
      }
    }
    options.signal?.throwIfAborted();
    target.canvas.width = width;
    target.canvas.height = height;
    target.drawImage(canvas, 0, 0);
  } finally {
    canvas.width = canvas.height = 0;
  }
}
