import { createCanvasPlan } from "./canvas.js";
import { Matrix } from "./matrix.js";
import type { PDFPage } from "./page.js";
import type { Matrix as Transform, Rect, RenderOptions } from "./types.js";

type Surface = ImageBitmap | OffscreenCanvas;
type Resource = {
  bytes: number;
  pins: number;
  owner: string;
  value: Surface | Blob;
  priority: number;
  remove: () => void;
};
type Scan = {
  source?: Resource;
  matrix: Transform;
  box: Rect;
  width: number;
  height: number;
  interpolate: boolean;
  levels: Map<string, Resource>;
  tiles: Map<string, Resource>;
};
export interface ScanCanvasStats {
  bytes: number;
  reservedBytes: number;
  peakBytes: number;
  limit: number;
  workLimit: number;
  imageBytes: number;
  encodedBytes: number;
  tileBytes: number;
  pages: number;
  decodes: number;
  renders: number;
  tileHits: number;
  fallbacks: number;
  evictions: number;
}
export interface ScanCanvasOptions {
  /** Retained Blob, image-pyramid and output-tile storage, in bytes. */
  byteLimit?: number;
  /** Allows one source and destination to coexist while generating a level.
   * Browser-internal decoder/GPU allocations are outside this accounting. */
  workLimit?: number;
  /** Hosts can reduce the native image-cache budget by this managed usage. */
  onMemoryChange?: (bytes: number) => void;
}
export interface ScanDrawOptions extends RenderOptions {
  /** Stable page identity; clear the renderer after edits/reordering. */
  key: string;
  /** Background work can reuse existing levels without decoding other pages. */
  populate?: boolean;
  /** The host can publish prepared tiles directly without retaining a copy. */
  cacheOutput?: boolean;
  signal?: AbortSignal;
  checkpoint: () => void;
  yieldTask: () => Promise<void>;
}

const MiB = 1024 * 1024;
const context2d = (canvas: OffscreenCanvas) => {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context || context.isContextLost())
    throw new Error("Canvas unavailable");
  return context;
};
const sizeKey = (width: number, height: number) => `${width}x${height}`;
const removeKey = (map: Map<string, Resource>, key: string) => () =>
  map.delete(key);
const removeSource = (scan: Scan) => () => {
  scan.source = undefined;
};
const close = (value: Resource["value"]) => {
  if (value instanceof Blob) return;
  if ("close" in value) value.close();
  else value.width = value.height = 0;
};

/** Browser-only scan fast path. It never opens a document and never renders an
 * unsupported page partially. Serialize calls with the owning PDF worker.
 * Retained resources share an LRU; a decode or resize has separate work headroom.
 */
export class ScanCanvasRenderer {
  private readonly pages = new Map<string, Scan | null>();
  private readonly lru = new Set<Resource>();
  private readonly limit: number;
  private readonly workLimit: number;
  private bytes = 0;
  private reserved = 0;
  private peak = 0;
  private generation = 0;
  private counters = {
    decodes: 0,
    renders: 0,
    tileHits: 0,
    fallbacks: 0,
    evictions: 0,
  };

  constructor(private readonly options: ScanCanvasOptions = {}) {
    this.limit = options.byteLimit ?? 512 * MiB;
    this.workLimit = options.workLimit ?? 640 * MiB;
    if (
      !Number.isSafeInteger(this.limit) ||
      this.limit < 0 ||
      !Number.isSafeInteger(this.workLimit) ||
      this.workLimit < this.limit
    )
      throw new Error("Invalid scan cache budget");
  }

  stats(): ScanCanvasStats {
    let encodedBytes = 0,
      imageBytes = 0,
      tileBytes = 0;
    for (const page of this.pages.values()) {
      if (!page) continue;
      encodedBytes += page.source?.bytes ?? 0;
      for (const image of page.levels.values()) imageBytes += image.bytes;
      for (const tile of page.tiles.values()) tileBytes += tile.bytes;
    }
    return {
      ...this.counters,
      bytes: this.bytes,
      reservedBytes: this.reserved,
      peakBytes: this.peak,
      limit: this.limit,
      workLimit: this.workLimit,
      encodedBytes,
      imageBytes,
      tileBytes,
      pages: [...this.pages.values()].filter(Boolean).length,
    };
  }

  clear() {
    this.generation++;
    for (const resource of [...this.lru]) this.drop(resource);
    this.pages.clear();
    this.changed();
  }

  private changed() {
    this.peak = Math.max(this.peak, this.bytes + this.reserved);
    this.options.onMemoryChange?.(this.bytes + this.reserved);
  }
  private touch(resource: Resource) {
    this.lru.delete(resource);
    this.lru.add(resource);
  }
  private drop(resource: Resource) {
    if (!this.lru.delete(resource)) return;
    resource.remove();
    this.bytes -= resource.bytes;
    close(resource.value);
    this.changed();
  }
  private trim(limit = this.limit) {
    // Regenerating encoded bytes/derived levels is cheaper than decoding a
    // source again. Within each tier retain normal least-recently-used order.
    for (let priority = 0; priority <= 3; priority++)
      for (const resource of this.lru) {
        if (this.bytes + this.reserved <= limit) return;
        if (resource.pins || resource.priority !== priority) continue;
        this.counters.evictions++;
        this.drop(resource);
      }
  }
  private reserve(bytes: number, evict = true) {
    // Use temporary headroom throughout the resize. Trimming on intermediate
    // unpins can evict a source while the final, much smaller level is pending.
    // Apply the retained limit only once all resources in this render unpin.
    if (evict) this.trim(Math.max(0, this.workLimit - bytes));
    if (this.bytes + this.reserved + bytes > this.workLimit)
      throw new DOMException(
        "Scan work budget exhausted",
        "QuotaExceededError",
      );
    this.reserved += bytes;
    this.changed();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.reserved -= bytes;
      this.changed();
    };
  }
  private adopt(
    owner: string,
    value: Resource["value"],
    bytes: number,
    remove: () => void,
    priority = 1,
  ) {
    const resource: Resource = {
      owner,
      value,
      bytes,
      pins: 1,
      remove,
      priority,
    };
    this.bytes += bytes;
    this.lru.add(resource);
    this.changed();
    return resource;
  }
  private unpin(resource: Resource) {
    resource.pins--;
  }
  private forget(key: string) {
    this.pages.delete(key);
    for (const resource of [...this.lru])
      if (resource.owner === key) this.drop(resource);
  }
  private encoded(key: string, scan: Scan, bytes: Uint8Array<ArrayBuffer>) {
    const release = this.reserve(bytes.byteLength);
    try {
      const blob = new Blob([bytes], { type: "image/jpeg" });
      release();
      return (scan.source = this.adopt(
        key,
        blob,
        blob.size,
        removeSource(scan),
        0,
      ));
    } finally {
      release();
    }
  }
  /** Return promptly on abort, but keep outstanding browser allocations charged
   * until they settle. A late result can never enter a newer generation. */
  private image(
    promise: Promise<ImageBitmap>,
    signal: AbortSignal | undefined,
    check: () => void,
    release: () => void,
  ): Promise<ImageBitmap> {
    return new Promise((resolve, reject) => {
      let abandoned = false;
      const abort = () => {
        abandoned = true;
        reject(new DOMException("Scan cancelled", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      void promise.then(
        (value) => {
          signal?.removeEventListener("abort", abort);
          release();
          if (abandoned) {
            value.close();
            return;
          }
          try {
            check();
            resolve(value);
          } catch (error) {
            value.close();
            reject(error);
          }
        },
        (error) => {
          signal?.removeEventListener("abort", abort);
          release();
          if (!abandoned) reject(error);
        },
      );
    });
  }

  async render(
    page: PDFPage,
    target: OffscreenCanvasRenderingContext2D,
    transform: Transform,
    bounds: Rect,
    options: ScanDrawOptions,
  ): Promise<boolean> {
    const fail = () => {
      this.counters.fallbacks++;
      return false;
    };
    if (
      typeof OffscreenCanvas === "undefined" ||
      typeof createImageBitmap === "undefined" ||
      options.annotations !== false ||
      options.keepAnnotations?.size ||
      options.contents === false ||
      options.transparent
    )
      return fail();
    const width = Math.ceil(bounds[2]) - Math.floor(bounds[0]);
    const height = Math.ceil(bounds[3]) - Math.floor(bounds[1]);
    if (
      !this.limit ||
      ![...transform, ...bounds].every(Number.isFinite) ||
      width <= 0 ||
      height <= 0 ||
      width * height > 64_000_000
    )
      return fail();
    const generation = this.generation;
    let interrupted = false;
    const check = () => {
      try {
        options.signal?.throwIfAborted();
        options.checkpoint();
        if (this.generation !== generation)
          throw new DOMException("Scan invalidated", "AbortError");
      } catch (error) {
        interrupted = true;
        throw error;
      }
    };
    const pause = async () => {
      try {
        await options.yieldTask();
      } catch (error) {
        interrupted = true;
        throw error;
      }
      check();
    };
    let source: Resource | undefined,
      image: Resource | undefined,
      output: Resource | undefined,
      zoomSource: Resource | undefined;
    try {
      check();
      let scan = this.pages.get(options.key);
      if (scan === null) return fail();
      if (!scan) {
        if (options.populate === false) return fail();
        const plan = createCanvasPlan(page, { annotations: false });
        if (
          !plan ||
          plan.commands.length !== 11 ||
          plan.commands[0] !== 2 ||
          plan.commands[7] !== 0 ||
          plan.images.length !== 1
        ) {
          if (this.pages.size >= 256)
            this.forget(this.pages.keys().next().value!);
          this.pages.set(options.key, null);
          return fail();
        }
        scan = {
          matrix: Array.from(plan.commands.subarray(1, 7)) as Transform,
          width: plan.commands[8],
          height: plan.commands[9],
          interpolate: !!plan.commands[10],
          box: plan.box,
          levels: new Map(),
          tiles: new Map(),
        };
        if (this.pages.size >= 256)
          this.forget(this.pages.keys().next().value!);
        this.pages.set(options.key, scan);
        source = this.encoded(options.key, scan, plan.images[0]);
      } else if (scan.source) {
        source = scan.source;
        source.pins++;
        this.touch(source);
      }
      // PDF image coordinates run upwards; decoded bitmap rows run downwards.
      const m = Matrix.concat(
        Matrix.concat([1, 0, 0, -1, 0, 1], scan.matrix),
        transform,
      );
      const normal = m[1] === 0 && m[2] === 0;
      const rotated = m[0] === 0 && m[3] === 0;
      if ((!normal && !rotated) || Math.abs(m[0] * m[3] - m[1] * m[2]) < 1e-10)
        return fail();
      const smoothingScale = Math.fround(
        ((globalThis.devicePixelRatio || 1) * 4) / 3,
      );
      const smooth =
        scan.interpolate ||
        (Math.hypot(m[0], m[1]) / scan.width <= smoothingScale &&
          Math.hypot(m[2], m[3]) / scan.height <= smoothingScale);
      // Browser nearest-neighbor sampling under a quarter-turn can choose
      // different source pixels for overlapping clips. Preserve native tiles
      // for that magnification case instead of allowing one-pixel jumps.
      if (rotated && !smooth) return fail();
      const x = Math.floor(bounds[0]),
        y = Math.floor(bounds[1]);
      const startX = Math.round(m[4]),
        startY = Math.round(m[5]);
      const drawWidth =
        Math.abs(Math.round(m[4] + (normal ? m[0] : m[2])) - startX) || 1;
      const drawHeight =
        Math.abs(Math.round(m[5] + (normal ? m[3] : m[1])) - startY) || 1;
      const imageWidth = normal ? drawWidth : drawHeight;
      const imageHeight = normal ? drawHeight : drawWidth;
      const tileKey = [...transform, x, y, width, height].join(",");
      const previous = scan.tiles.get(tileKey);
      if (previous) {
        this.counters.tileHits++;
        previous.pins++;
        this.touch(previous);
        output = previous;
      } else {
        let levelWidth = scan.width,
          levelHeight = scan.height;
        const inverse = Matrix.invert(
          Matrix.concat([1 / scan.width, 0, 0, 1 / scan.height, 0, 0], m),
        );
        let widthScale = Math.max(1, Math.hypot(inverse[0], inverse[1])),
          heightScale = Math.max(1, Math.hypot(inverse[2], inverse[3]));
        const steps: [number, number][] = [[levelWidth, levelHeight]];
        while (
          (widthScale > 2 && levelWidth > 1) ||
          (heightScale > 2 && levelHeight > 1)
        ) {
          if (widthScale > 2 && levelWidth > 1) {
            const previous = levelWidth;
            levelWidth = Math.ceil(levelWidth / 2);
            widthScale /= previous / levelWidth;
          }
          if (heightScale > 2 && levelHeight > 1) {
            const previous = levelHeight;
            levelHeight = Math.ceil(levelHeight / 2);
            heightScale /= previous / levelHeight;
          }
          steps.push([levelWidth, levelHeight]);
        }
        let step = steps.length - 1;
        for (; step >= 0; step--) {
          image = scan.levels.get(sizeKey(...steps[step]));
          if (image) {
            image.pins++;
            this.touch(image);
            break;
          }
        }
        if (!image) {
          if (options.populate === false) return fail();
          if (!source) {
            const plan = createCanvasPlan(page, { annotations: false });
            if (!plan || plan.images.length !== 1) return fail();
            source = this.encoded(options.key, scan, plan.images[0]);
          }
          const release = this.reserve(scan.width * scan.height * 4);
          let bitmap: ImageBitmap | undefined;
          let pending = false;
          try {
            const decoding = createImageBitmap(source.value as Blob, {
              imageOrientation: "none",
              colorSpaceConversion: "none",
            });
            pending = true;
            bitmap = await this.image(decoding, options.signal, check, release);
            if (bitmap.width !== scan.width || bitmap.height !== scan.height)
              throw new Error("JPEG dimensions differ");
            const key = sizeKey(scan.width, scan.height);
            release();
            image = this.adopt(
              options.key,
              bitmap,
              scan.width * scan.height * 4,
              removeKey(scan.levels, key),
            );
            scan.levels.set(key, image);
            bitmap = undefined;
            this.counters.decodes++;
            step = 0;
          } finally {
            bitmap?.close();
            if (!pending) release();
          }
        }
        // Keep a source through intermediate resize levels. Two recent large
        // scans can remain decoded, so the first zoom does not decode again.
        if (options.populate === false || step === 0) {
          zoomSource = image;
          if (options.populate !== false) {
            image.priority = image.bytes <= this.limit ? 3 : 1;
          }
          zoomSource.pins++;
          this.touch(zoomSource);
        }
        for (step++; step < steps.length; step++) {
          await pause();
          const [w, h] = steps[step],
            key = sizeKey(w, h);
          const release = this.reserve(w * h * 4, options.populate !== false);
          let surface: OffscreenCanvas | undefined;
          try {
            surface = new OffscreenCanvas(w, h);
            const ctx = context2d(surface);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "low";
            ctx.drawImage(image.value as Surface, 0, 0, w, h);
            // Flush the raster before caching it. A retained Canvas recording
            // can otherwise keep its much larger input image alive.
            const bitmap = surface.transferToImageBitmap();
            surface.width = surface.height = 0;
            surface = undefined;
            release();
            const next = this.adopt(
              options.key,
              bitmap,
              w * h * 4,
              removeKey(scan.levels, key),
              Math.max(imageWidth, imageHeight) > 2048 &&
                step === steps.length - 1 &&
                scan.width * scan.height * 4 + w * h * 4 <= this.limit
                ? 3
                : 1,
            );
            if (options.populate !== false) scan.levels.set(key, next);
            if (options.populate === false) {
              if (image === zoomSource) image.pins--;
              else this.drop(image);
            } else this.unpin(image);
            image = next;
          } finally {
            if (surface) surface.width = surface.height = 0;
            release();
          }
        }
        await pause();
        const direct =
          options.cacheOutput === false || width * height * 4 > 8 * MiB;
        const release = direct
          ? () => {}
          : this.reserve(width * height * 4, options.populate !== false);
        let stage: OffscreenCanvas | undefined;
        try {
          if (direct) {
            if (target.isContextLost())
              throw new Error("Destination canvas context lost");
            if (
              target.canvas.width !== width ||
              target.canvas.height !== height
            ) {
              target.canvas.width = width;
              target.canvas.height = height;
            }
          } else stage = new OffscreenCanvas(width, height);
          const ctx = direct ? target : context2d(stage!);
          ctx.save();
          try {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, width, height);
            ctx.setTransform(
              transform[0],
              transform[1],
              transform[2],
              transform[3],
              transform[4] - x,
              transform[5] - y,
            );
            ctx.beginPath();
            ctx.rect(
              scan.box[0],
              scan.box[1],
              scan.box[2] - scan.box[0],
              scan.box[3] - scan.box[1],
            );
            ctx.clip();
            // Match PDF.js's small-scale smoothing boundary (PDF points to CSS
            // pixels). Larger magnification retains the PDF Interpolate choice.
            ctx.imageSmoothingEnabled = smooth;
            ctx.imageSmoothingQuality = "low";
            ctx.setTransform(
              normal ? Math.sign(m[0]) : 0,
              rotated ? Math.sign(m[1]) : 0,
              rotated ? Math.sign(m[2]) : 0,
              normal ? Math.sign(m[3]) : 0,
              startX - x,
              startY - y,
            );
            ctx.drawImage(
              image.value as Surface,
              0,
              0,
              imageWidth,
              imageHeight,
            );
            if (!direct) check();
            if (ctx.isContextLost())
              throw new Error("Scan canvas context lost");
          } finally {
            ctx.restore();
          }
          // All potentially asynchronous work and cancellation checks precede
          // this synchronous tile publication. Avoid an output-sized bitmap
          // allocation and copy for every new viewport tile.
          if (direct) {
            this.counters.renders++;
            return true;
          }
          const bitmap = stage!.transferToImageBitmap();
          stage!.width = stage!.height = 0;
          stage = undefined;
          release();
          output = this.adopt(
            options.key,
            bitmap,
            width * height * 4,
            removeKey(scan.tiles, tileKey),
            2,
          );
          if (output.bytes <= 8 * MiB && options.populate !== false)
            scan.tiles.set(tileKey, output);
        } finally {
          if (stage) stage.width = stage.height = 0;
          release();
        }
      }
      check();
      if (target.isContextLost())
        throw new Error("Destination canvas context lost");
      if (target.canvas.width !== width || target.canvas.height !== height) {
        target.canvas.width = width;
        target.canvas.height = height;
      }
      target.save();
      try {
        target.setTransform(1, 0, 0, 1, 0, 0);
        target.globalAlpha = 1;
        target.globalCompositeOperation = "copy";
        target.drawImage(output.value as Surface, 0, 0);
      } finally {
        target.restore();
      }
      this.counters.renders++;
      return true;
    } catch (error) {
      if (interrupted) throw error;
      check();
      if (
        !(
          options.populate === false &&
          error instanceof DOMException &&
          error.name === "QuotaExceededError"
        )
      )
        this.forget(options.key);
      return fail();
    } finally {
      if (image) {
        if (options.populate === false) {
          if (image === zoomSource) image.pins--;
          else this.drop(image);
        } else this.unpin(image);
      }
      if (output) {
        if (
          !this.pages
            .get(options.key)
            ?.tiles.has(
              [
                ...transform,
                Math.floor(bounds[0]),
                Math.floor(bounds[1]),
                width,
                height,
              ].join(","),
            )
        )
          this.drop(output);
        else this.unpin(output);
      }
      if (zoomSource) this.unpin(zoomSource);
      if (source) this.unpin(source);
      this.trim();
    }
  }
}
