/* global self, performance, OffscreenCanvas, Path2D, Blob, createImageBitmap,
   ImageData, MessageChannel, requestAnimationFrame, fetch, btoa */
// Diagnostic only. The cached replay is deliberately outside the production SDK.
import {
  createPDFium,
  createCanvasPlan,
  drawCanvasPlan,
} from "/sdk/dist/index.js";

let engine, doc, page, canvas, context, plan, prepared;
const channel = new MessageChannel();
const pending = [];
channel.port1.onmessage = () => pending.shift()?.();
const yieldTask = () =>
  new Promise((resolve) => {
    pending.push(resolve);
    channel.port2.postMessage(null);
  });
const rgb = (value) =>
  `rgb(${value & 255} ${(value >>> 8) & 255} ${(value >>> 16) & 255})`;

async function makeFixture(kind) {
  const result = new engine.PDFDocument();
  if (kind === "paths") {
    const commands = [];
    for (let i = 0; i < 10000; i++) {
      const x = ((i * 37) % 1190) + 5,
        y = ((i * 59) % 790) + 5;
      commands.push(
        `${(i % 7) / 7} ${(i % 11) / 11} ${(i % 13) / 13} RG 0.6 w ${x} ${y} m ${x + 3} ${y + 5} ${x + 4} ${y - 4} ${x + 6} ${y + 1} c S`,
      );
    }
    result.insertPage(
      -1,
      result.addPage([0, 0, 1200, 800], 0, {}, commands.join("\n")),
    );
  } else {
    const source = new OffscreenCanvas(4000, 3000),
      ctx = source.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 4000, 3000);
    gradient.addColorStop(0, "#203050");
    gradient.addColorStop(1, "#ffeebb");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4000, 3000);
    for (let i = 0; i < 3000; i++) {
      ctx.fillStyle = `rgb(${(i * 17) % 256} ${(i * 43) % 256} ${(i * 29) % 256})`;
      ctx.fillRect((i * 67) % 3980, (i * 97) % 2980, 20, 20);
    }
    const encoded = new Uint8Array(
      await (
        await source.convertToBlob({ type: "image/jpeg", quality: 0.92 })
      ).arrayBuffer(),
    );
    source.width = source.height = 0;
    // The generated fixture alone loses optional metadata; real PDFs are untouched.
    const parts = [encoded.slice(0, 2)];
    for (let offset = 2; offset < encoded.length; ) {
      if (encoded[offset] !== 255) throw Error("Invalid generated JPEG");
      const marker = encoded[offset + 1];
      if (marker === 0xda) {
        parts.push(encoded.slice(offset));
        break;
      }
      const end = offset + 2 + encoded[offset + 2] * 256 + encoded[offset + 3];
      if (![0xe1, 0xe2, 0xee].includes(marker))
        parts.push(encoded.slice(offset, end));
      offset = end;
    }
    const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
    const image = result.addObject({
      Type: "XObject",
      Subtype: "Image",
      Width: 4000,
      Height: 3000,
      ColorSpace: "DeviceRGB",
      BitsPerComponent: 8,
      Filter: "DCTDecode",
      Interpolate: true,
    });
    image.writeRawStream(bytes);
    result.insertPage(
      -1,
      result.addPage(
        [0, 0, 1200, 900],
        0,
        { XObject: { Im: image } },
        "q 1200 0 0 900 0 0 cm /Im Do Q",
      ),
    );
    image.destroy();
  }
  return result;
}

function transformBox(box, m) {
  const points = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[2], box[3]],
    [box[0], box[3]],
  ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
}

async function compilePlan(value) {
  const commands = [],
    bitmaps = [];
  const data = value.commands;
  let n = 0;
  while (n < data.length) {
    const type = data[n++],
      matrix = Array.from(data.subarray(n, n + 6));
    n += 6;
    if (type === 1) {
      const fill = data[n++],
        stroke = data[n++],
        fillStyle = rgb(data[n++]),
        strokeStyle = rgb(data[n++]);
      const lineWidth = data[n++],
        lineCap = ["butt", "round", "square"][data[n++]],
        lineJoin = ["miter", "round", "bevel"][data[n++]],
        miterLimit = data[n++],
        lineDashOffset = data[n++];
      const dashCount = data[n++],
        dash = Array.from(data.subarray(n, n + dashCount));
      n += dashCount;
      const count = data[n++],
        end = n + count * 4,
        path = new Path2D();
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (let at = n; at < end; at += 4) {
        x0 = Math.min(x0, data[at + 1]);
        y0 = Math.min(y0, data[at + 2]);
        x1 = Math.max(x1, data[at + 1]);
        y1 = Math.max(y1, data[at + 2]);
      }
      while (n < end) {
        const kind = data[n],
          x = data[n + 1],
          y = data[n + 2];
        if (kind === 2) path.moveTo(x, y);
        else if (kind === 0) path.lineTo(x, y);
        else if (
          kind === 1 &&
          n + 11 < end &&
          data[n + 4] === 1 &&
          data[n + 8] === 1
        ) {
          path.bezierCurveTo(
            x,
            y,
            data[n + 5],
            data[n + 6],
            data[n + 9],
            data[n + 10],
          );
          n += 8;
        } else throw Error("Unsupported diagnostic path");
        if (data[n + 3]) path.closePath();
        n += 4;
      }
      const pad = stroke ? lineWidth * Math.max(1, miterLimit) : 0;
      commands.push({
        type,
        matrix,
        path,
        fill,
        stroke,
        fillStyle,
        strokeStyle,
        lineWidth,
        lineCap,
        lineJoin,
        miterLimit,
        lineDashOffset,
        dash,
        box: transformBox([x0 - pad, y0 - pad, x1 + pad, y1 + pad], matrix),
      });
    } else if (type === 2) {
      const index = data[n++],
        width = data[n++],
        height = data[n++],
        smooth = !!data[n++];
      commands.push({
        type,
        matrix,
        index,
        width,
        height,
        smooth,
        box: transformBox([0, 0, 1, 1], matrix),
      });
    } else throw Error("Unsupported diagnostic command");
  }
  try {
    for (const bytes of value.images)
      bitmaps.push(
        await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }), {
          imageOrientation: "none",
          colorSpaceConversion: "none",
        }),
      );
    return { commands, bitmaps, box: value.box };
  } catch (error) {
    for (const bitmap of bitmaps) bitmap.close();
    throw error;
  }
}

async function drawPrepared(
  value,
  target,
  matrix,
  bounds,
  highQuality = false,
) {
  const width = bounds[2] - bounds[0],
    height = bounds[3] - bounds[1];
  const stage = new OffscreenCanvas(width, height),
    ctx = stage.getContext("2d", { alpha: false });
  let drawn = 0,
    culled = 0,
    deadline = performance.now() + 8;
  try {
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(
      matrix[0],
      matrix[1],
      matrix[2],
      matrix[3],
      matrix[4] - bounds[0],
      matrix[5] - bounds[1],
    );
    ctx.beginPath();
    ctx.rect(
      value.box[0],
      value.box[1],
      value.box[2] - value.box[0],
      value.box[3] - value.box[1],
    );
    ctx.clip();
    for (const command of value.commands) {
      const box = transformBox(command.box, matrix);
      if (
        box[2] < bounds[0] - 2 ||
        box[3] < bounds[1] - 2 ||
        box[0] > bounds[2] + 2 ||
        box[1] > bounds[3] + 2
      ) {
        culled++;
        continue;
      }
      drawn++;
      ctx.save();
      ctx.transform(...command.matrix);
      if (command.type === 1) {
        ctx.fillStyle = command.fillStyle;
        ctx.strokeStyle = command.strokeStyle;
        ctx.lineWidth = command.lineWidth;
        ctx.lineCap = command.lineCap;
        ctx.lineJoin = command.lineJoin;
        ctx.miterLimit = command.miterLimit;
        ctx.lineDashOffset = command.lineDashOffset;
        ctx.setLineDash(command.dash);
        if (command.fill)
          ctx.fill(command.path, command.fill === 2 ? "evenodd" : "nonzero");
        if (command.stroke) ctx.stroke(command.path);
      } else {
        const bitmap = value.bitmaps[command.index];
        if (bitmap.width !== command.width || bitmap.height !== command.height)
          throw Error("Unexpected JPEG dimensions");
        const projected = engine.Matrix.concat(command.matrix, matrix);
        const minifying =
          Math.hypot(projected[0], projected[1]) < command.width &&
          Math.hypot(projected[2], projected[3]) < command.height;
        ctx.imageSmoothingEnabled =
          command.smooth || (highQuality && minifying);
        if (highQuality) ctx.imageSmoothingQuality = "high";
        ctx.transform(1, 0, 0, -1, 0, 1);
        ctx.drawImage(bitmap, 0, 0, 1, 1);
      }
      ctx.restore();
      if (performance.now() >= deadline) {
        await yieldTask();
        deadline = performance.now() + 8;
      }
    }
    if (target.canvas.width !== width || target.canvas.height !== height) {
      target.canvas.width = width;
      target.canvas.height = height;
    }
    target.drawImage(stage, 0, 0);
    return { drawn, culled };
  } finally {
    stage.width = stage.height = 0;
  }
}

function geometry(task) {
  const bounds = page.getBounds(),
    scale = task.longEdge / Math.max(bounds[2], bounds[3]);
  const matrix = engine.Matrix.concat(
    page.getTransform(),
    engine.Matrix.scale(scale, scale),
  );
  const width = Math.ceil(bounds[2] * scale),
    height = Math.ceil(bounds[3] * scale);
  const x = Math.floor((width - 1024) / 2),
    y = Math.floor((height - 1024) / 2);
  return {
    matrix,
    bounds: task.tile ? [x, y, x + 1024, y + 1024] : [0, 0, width, height],
  };
}

async function draw(mode, target, task) {
  const { matrix, bounds } = geometry(task),
    started = performance.now();
  const stages = {};
  if (mode === "native") {
    const job = page.startRender(matrix, bounds, { annotations: false });
    try {
      let yields = 0;
      while (!job.continue(8)) {
        yields++;
        await yieldTask();
      }
      const pixmap = job.finish();
      try {
        stages.rasterMs = performance.now() - started;
        stages.yields = yields;
        const writeStarted = performance.now(),
          bytes = pixmap.getPixels();
        if (
          target.canvas.width !== pixmap.width ||
          target.canvas.height !== pixmap.height
        ) {
          target.canvas.width = pixmap.width;
          target.canvas.height = pixmap.height;
        }
        target.putImageData(
          new ImageData(
            new Uint8ClampedArray(
              bytes.buffer,
              bytes.byteOffset,
              bytes.byteLength,
            ),
            pixmap.width,
            pixmap.height,
          ),
          0,
          0,
        );
        stages.writeMs = performance.now() - writeStarted;
      } finally {
        pixmap.destroy();
      }
    } finally {
      job.destroy();
    }
  } else if (mode === "commands") {
    await drawCanvasPlan(plan, target, matrix, bounds);
  } else
    Object.assign(
      stages,
      await drawPrepared(
        prepared,
        target,
        matrix,
        bounds,
        mode === "cached-high",
      ),
    );
  stages.drawMs = performance.now() - started;
  return stages;
}

function inspectResources() {
  const object = page.getObject(),
    resources = object.getInheritable("Resources");
  const take = (parent, key, fn) => {
    const item = parent.get(key);
    try {
      return fn(item);
    } finally {
      item.destroy();
    }
  };
  try {
    const xobjects = resources.get("XObject"),
      images = [],
      forms = [];
    try {
      for (const name of xobjects.keys()) {
        const item = xobjects.get(name);
        try {
          const type = take(item, "Subtype", (v) => v.asName());
          if (type === "Image")
            images.push({
              name,
              filter: take(item, "Filter", (v) => v.toString()),
              colorSpace: take(item, "ColorSpace", (v) => v.toString()).slice(
                0,
                120,
              ),
              width: take(item, "Width", (v) => v.asNumber()),
              height: take(item, "Height", (v) => v.asNumber()),
              hasMask: ["Mask", "SMask"].some((key) =>
                take(item, key, (v) => !v.isNull()),
              ),
            });
          if (type === "Form") forms.push(name);
        } finally {
          item.destroy();
        }
      }
    } finally {
      xobjects.destroy();
    }
    return {
      pageGroup: take(object, "Group", (v) => v.toString()),
      fonts: take(resources, "Font", (v) => v.keys().length),
      graphicsStates: take(resources, "ExtGState", (v) => v.keys().length),
      forms,
      images,
    };
  } finally {
    resources.destroy();
    object.destroy();
  }
}

async function run(message) {
  if (message.type === "init") {
    canvas = message.canvas;
    context = canvas.getContext("2d", { alpha: false });
    const started = performance.now();
    engine = await createPDFium({ moduleUrl: "/sdk/wasm/pdfium.js" });
    return {
      wasmMs: performance.now() - started,
      context: context.getContextAttributes(),
    };
  }
  if (message.type === "open") {
    let bytes;
    if (message.fixture !== undefined)
      bytes = new Uint8Array(
        await (await fetch(`/fixture/${message.fixture}`)).arrayBuffer(),
      );
    const started = performance.now();
    doc = bytes
      ? new engine.PDFDocument(bytes)
      : await makeFixture(message.kind);
    const opened = performance.now();
    page = doc.loadPage(message.pageIndex ?? 0);
    return {
      openMs: opened - started,
      pageLoadMs: performance.now() - opened,
      liveDocuments: engine.liveDocuments(),
    };
  }
  if (message.type === "prepare") {
    const started = performance.now();
    plan = createCanvasPlan(page, { annotations: false });
    const planMs = performance.now() - started;
    if (!plan)
      return { supported: false, planMs, resources: inspectResources() };
    const compileStarted = performance.now();
    if (message.mode.startsWith("cached")) prepared = await compilePlan(plan);
    return {
      supported: true,
      planMs,
      compileMs: performance.now() - compileStarted,
      commandBytes: plan.commands.byteLength,
      encodedImageBytes: plan.images.reduce((sum, b) => sum + b.byteLength, 0),
      bitmapBytes:
        prepared?.bitmaps.reduce(
          (sum, bitmap) => sum + bitmap.width * bitmap.height * 4,
          0,
        ) ?? 0,
    };
  }
  if (message.type === "render") {
    const started = performance.now(),
      stages = await draw(message.mode, context, message.task);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return {
      ...stages,
      responseMs: performance.now() - started,
      width: canvas.width,
      height: canvas.height,
      wasmCapacity: engine.memory(),
      imageCache: engine.largeImageCache(),
    };
  }
  if (message.type === "inspect") {
    return {
      resources: inspectResources(),
      annotationsIncludedSupported: !!createCanvasPlan(page),
    };
  }
  if (message.type === "validate") {
    plan = createCanvasPlan(page, { annotations: false });
    if (!plan) return { supported: false };
    prepared = await compilePlan(plan);
    const records = [],
      captures = [];
    for (const task of message.tasks) {
      let reference, commandPixels;
      for (const mode of [
        "native",
        "commands",
        "cached",
        ...(message.highQuality ? ["cached-high"] : []),
      ]) {
        const target = new OffscreenCanvas(1, 1),
          ctx = target.getContext("2d", { alpha: false });
        await draw(mode, ctx, task);
        const pixels = ctx.getImageData(0, 0, target.width, target.height).data;
        if (mode === "native") reference = pixels;
        else {
          let severe = 0,
            absolute = 0,
            cachedDifferentChannels = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            let largest = 0;
            for (let c = 0; c < 4; c++) {
              const delta = Math.abs(reference[i + c] - pixels[i + c]);
              largest = Math.max(largest, delta);
              absolute += delta;
              if (mode === "cached" && commandPixels[i + c] !== pixels[i + c])
                cachedDifferentChannels++;
            }
            if (largest > 16) severe++;
          }
          records.push({
            mode,
            task,
            severeFraction: severe / (pixels.length / 4),
            meanAbsoluteChannelError: absolute / pixels.length,
            cachedDifferentChannels:
              mode === "cached" ? cachedDifferentChannels : undefined,
          });
          if (mode === "commands") commandPixels = pixels;
        }
        if (
          message.capture &&
          task.name === "page1600" &&
          mode !== "commands"
        ) {
          const png = new Uint8Array(
            await (
              await target.convertToBlob({ type: "image/png" })
            ).arrayBuffer(),
          );
          let binary = "";
          for (let offset = 0; offset < png.length; offset += 32768)
            binary += String.fromCharCode(
              ...png.subarray(offset, offset + 32768),
            );
          captures.push({ mode, png: btoa(binary) });
        }
        target.width = target.height = 0;
      }
    }
    return { records, captures };
  }
  if (message.type === "close") {
    for (const bitmap of prepared?.bitmaps ?? []) bitmap.close();
    prepared = plan = undefined;
    page?.destroy();
    doc?.destroy();
    page = doc = undefined;
    canvas.width = canvas.height = 0;
    return {
      liveDocuments: engine.liveDocuments(),
      imageCache: engine.largeImageCache(),
    };
  }
  throw Error("Unknown benchmark request");
}
self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ id: data.id, result: await run(data) });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.stack ?? String(error) });
  }
};
