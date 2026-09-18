/* global HTMLCanvasElement, OffscreenCanvas, document, crypto, CSS, performance, requestAnimationFrame, cancelAnimationFrame */
// Rendering core from the user-supplied ASCII Tidal Field; see ../README.md.
import { matrixGlyphFor } from "./glyph-matrix.js";
import { DEFAULT_QUIET_ZONE, QUALITY_PROFILES, THEMES } from "./themes.js";

const TAU = Math.PI * 2;

const BASE_CONFIG = Object.freeze({
  simulationHz: 30,
  renderHz: 60,
  maxSubsteps: 3,
  timeScale: 1,
  viscosity: 0.07,
  diffusion: 0.025,
  decay: 0.13,
  drag: 0.2,
  cloudCount: 11,
  warmupSteps: 8,
  waveCacheHz: 15,
  waveForceResponse: 10,
  waveCount: 4,
  waveStrength: 14,
  waveDye: 0.1,
  pointerForce: 3,
  pointerDye: 1.1,
  rippleStrength: 22,
  rippleLifetime: 3.5,
  rippleInterval: 280,
  maxRipples: 7,
  visualResponse: 8,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mix = (a, b, t) => a + (b - a) * t;

function makeSeed() {
  if (globalThis.crypto?.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

function hexRGB(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

function buildPalette(colors) {
  const stops = colors.map(([t, hex]) => ({ t, rgb: hexRGB(hex) }));

  return Array.from({ length: 256 }, (_, i) => {
    const t = i / 255;
    let k = 0;

    while (k < stops.length - 2 && t > stops[k + 1].t) k += 1;

    const a = stops[k];
    const b = stops[k + 1];
    let f = clamp((t - a.t) / (b.t - a.t), 0, 1);
    f = f * f * (3 - 2 * f);

    const rgb = a.rgb.map((value, channel) =>
      Math.round(mix(value, b.rgb[channel], f)),
    );

    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  });
}

function validateStyle(next) {
  if (typeof next.chars !== "string" || Array.from(next.chars).length < 2) {
    throw new Error("chars must contain at least two characters");
  }

  const colors = next.colors;
  const validColors =
    Array.isArray(colors) &&
    colors.length >= 2 &&
    colors.every(
      (stop, i) =>
        Array.isArray(stop) &&
        Number.isFinite(stop[0]) &&
        /^#[0-9a-f]{6}$/i.test(stop[1]) &&
        (i === 0 || stop[0] > colors[i - 1][0]),
    ) &&
    colors[0][0] === 0 &&
    colors[colors.length - 1][0] === 1;

  if (!validColors) {
    throw new Error(
      "colors must be ascending stops from 0 to 1 using six-digit HEX",
    );
  }

  for (const key of [
    "scaleMin",
    "scaleMax",
    "densityGain",
    "motionGain",
    "sizeExponent",
  ]) {
    if (!Number.isFinite(next[key]) || next[key] <= 0) {
      throw new Error(`${key} must be a positive number`);
    }
  }

  if (next.scaleMax < next.scaleMin) {
    throw new Error("scaleMax cannot be smaller than scaleMin");
  }

  for (const key of ["opacity", "colorMotionMix", "sizeMotionMix"]) {
    if (!Number.isFinite(next[key]) || next[key] < 0 || next[key] > 1) {
      throw new Error(`${key} must be between 0 and 1`);
    }
  }

  if (globalThis.CSS?.supports) {
    for (const key of ["background", "foreground", "muted", "vignette"]) {
      if (!CSS.supports("color", next[key])) {
        throw new Error(`${key} is not a valid CSS color`);
      }
    }
  }
}

function resolveQuality(name) {
  if (name && name !== "auto" && QUALITY_PROFILES[name]) return name;

  const cores = Number(globalThis.navigator?.hardwareConcurrency || 8);
  const memory = Number(globalThis.navigator?.deviceMemory || 8);
  return cores <= 4 || memory <= 4 ? "low" : "medium";
}

function createAtlasCanvas() {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(1, 1);
  return document.createElement("canvas");
}

class GlyphAtlas {
  constructor() {
    this.canvas = createAtlasCanvas();
    this.ctx = this.canvas.getContext("2d", { alpha: true });
    this.ready = false;
    this.tileCss = 0;
    this.tilePx = 0;
    this.columns = 0;
    this.glyphCount = 0;
    this.colorBuckets = 0;
  }

  rebuild({
    style,
    palette,
    glyphs,
    fontSize,
    dpr,
    quality,
    glyphMode,
    dotShape,
  }) {
    const ctx = this.ctx;
    if (!ctx || !glyphs.length || fontSize <= 0) {
      this.ready = false;
      return;
    }

    this.glyphCount = glyphs.length;
    this.colorBuckets = quality.colorBuckets;
    this.tileCss = Math.ceil(fontSize * style.scaleMax * 1.65 + 6);
    this.tilePx = Math.max(1, Math.ceil(this.tileCss * dpr));

    const count = this.glyphCount * this.colorBuckets;
    this.columns = Math.min(64, Math.max(1, Math.ceil(Math.sqrt(count))));
    const rows = Math.ceil(count / this.columns);

    this.canvas.width = this.columns * this.tilePx;
    this.canvas.height = rows * this.tilePx;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${fontSize * style.scaleMax}px ui-monospace, SFMono-Regular, Consolas, monospace`;

    const matrixFontSize = fontSize * style.scaleMax;

    for (
      let colorBucket = 0;
      colorBucket < this.colorBuckets;
      colorBucket += 1
    ) {
      const colorT =
        this.colorBuckets === 1 ? 0 : colorBucket / (this.colorBuckets - 1);
      ctx.fillStyle = palette[Math.round(colorT * 255)];

      for (let glyphIndex = 0; glyphIndex < this.glyphCount; glyphIndex += 1) {
        const index = colorBucket * this.glyphCount + glyphIndex;
        const column = index % this.columns;
        const row = Math.floor(index / this.columns);
        const cx = (column + 0.5) * this.tileCss;
        const cy = (row + 0.5) * this.tileCss;

        if (glyphMode === "dot") {
          this.drawMatrixGlyph(
            ctx,
            glyphs[glyphIndex],
            cx,
            cy,
            matrixFontSize,
            dotShape,
          );
        } else {
          ctx.fillText(glyphs[glyphIndex], cx, cy);
        }
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ready = true;
  }

  drawMatrixGlyph(ctx, character, cx, cy, fontSize, dotShape) {
    const pattern = matrixGlyphFor(character);
    const rows = pattern.length;
    const cols = pattern[0]?.length || 1;

    // Match the visual footprint of a narrow monospace glyph while keeping
    // each LED/pixel isolated enough to remain readable after atlas scaling.
    const targetHeight = fontSize * 0.96;
    const targetWidth = targetHeight * (cols / rows) * 0.86;
    const pitch = Math.min(targetWidth / cols, targetHeight / rows);
    const dotSize = Math.max(0.55, pitch * 0.72);
    const startX = cx - ((cols - 1) * pitch) / 2;
    const startY = cy - ((rows - 1) * pitch) / 2;

    for (let y = 0; y < rows; y += 1) {
      const row = pattern[y];
      for (let x = 0; x < cols; x += 1) {
        if (row[x] !== "1") continue;

        const px = startX + x * pitch;
        const py = startY + y * pitch;

        if (dotShape === "square") {
          ctx.fillRect(px - dotSize / 2, py - dotSize / 2, dotSize, dotSize);
        } else {
          ctx.beginPath();
          ctx.arc(px, py, dotSize / 2, 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  sprite(glyphIndex, colorValue) {
    const colorBucket = clamp(
      Math.round(colorValue * (this.colorBuckets - 1)),
      0,
      this.colorBuckets - 1,
    );
    const index = colorBucket * this.glyphCount + glyphIndex;
    const column = index % this.columns;
    const row = Math.floor(index / this.columns);

    return {
      sx: column * this.tilePx,
      sy: row * this.tilePx,
      sw: this.tilePx,
      sh: this.tilePx,
    };
  }
}

export class ASCIIFluidEngine {
  constructor(canvas, options = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError("ASCIIFluidEngine requires a canvas element");
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    if (!this.ctx) throw new Error("2D canvas is not available");

    this.config = { ...BASE_CONFIG, ...options.config };
    this.qualityName = options.quality || "auto";
    this.resolvedQualityName = resolveQuality(this.qualityName);
    this.quality = QUALITY_PROFILES[this.resolvedQualityName];
    this.glyphMode = options.glyphMode === "font" ? "font" : "dot";
    this.dotShape = options.dotShape === "square" ? "square" : "round";

    this.styleName = THEMES[options.theme] ? options.theme : "ocean";
    this.style = { ...THEMES[this.styleName] };
    this.palette = buildPalette(this.style.colors);
    this.glyphs = Array.from(this.style.chars);
    this.onStyleChange = options.onStyleChange || null;

    this.quietZone = {
      ...DEFAULT_QUIET_ZONE,
      ...(options.quietZone || {}),
    };
    if (typeof options.quiet === "boolean")
      this.quietZone.enabled = options.quiet;

    this.currentSeed = Number.isFinite(options.seed)
      ? options.seed >>> 0
      : makeSeed();
    this.seed = this.currentSeed;

    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.nx = 0;
    this.ny = 0;
    this.stride = 0;
    this.size = 0;
    this.cellW = 0;
    this.cellH = 0;
    this.unit = 0;
    this.fontSize = 0;

    this.u = null;
    this.v = null;
    this.u0 = null;
    this.v0 = null;
    this.dye = null;
    this.dye0 = null;
    this.pressure = null;
    this.divergence = null;
    this.psi = null;
    this.targetFX = null;
    this.targetFY = null;
    this.forceX = null;
    this.forceY = null;
    this.dyeSource = null;
    this.visualDye = null;
    this.visualSpeed = null;
    this.quietMask = null;

    this.waves = [];
    this.ripples = [];
    this.atlas = new GlyphAtlas();

    this.time = 0;
    this.waveCacheElapsed = 0;
    this.accumulator = 0;
    this.lastTime = 0;
    this.lastRenderTime = 0;
    this.frameId = 0;
    this.initialized = false;
    this.destroyed = false;
    this.paused = Boolean(options.paused);
    this.suspensions = new Set();

    this.step = 1 / this.config.simulationHz;
    this.waveInterval = 1 / this.config.waveCacheHz;
    this.renderIntervalMs = 1000 / this.config.renderHz;

    this.pointer = {
      down: false,
      id: null,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      last: 0,
      lastRipple: -Infinity,
    };

    this._frame = (now) => this.frame(now);
    this.onStyleChange?.(this.style, this.styleName);
  }

  ix(x, y) {
    return x + y * this.stride;
  }

  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  range(a, b) {
    return mix(a, b, this.random());
  }

  setStyle(themeOrOptions) {
    if (this.destroyed) return;

    let options;
    let nextName = this.styleName;

    if (typeof themeOrOptions === "string") {
      options = THEMES[themeOrOptions];
      if (!options) throw new Error(`Unknown theme: ${themeOrOptions}`);
      nextName = themeOrOptions;
    } else {
      options = themeOrOptions;
    }

    if (!options || typeof options !== "object") {
      throw new Error(
        "Theme or style options must be an object or a known theme name",
      );
    }

    const next = { ...this.style, ...options };
    validateStyle(next);
    this.style = next;
    this.styleName = nextName;
    this.glyphs = Array.from(next.chars);
    this.palette = buildPalette(next.colors);
    this.rebuildAtlas();
    this.onStyleChange?.(this.style, this.styleName);
    if (this.initialized) this.render(0);
  }

  setQuality(name = "auto") {
    if (!["auto", "low", "medium", "high"].includes(name)) {
      throw new Error(`Unknown quality: ${name}`);
    }

    this.qualityName = name;
    const resolved = resolveQuality(name);
    if (resolved === this.resolvedQualityName) return;

    this.resolvedQualityName = resolved;
    this.quality = QUALITY_PROFILES[resolved];
    if (this.W > 0 && this.H > 0) this.resize(this.W, this.H, this.dpr, true);
  }

  setGlyphMode(mode = "dot") {
    if (!["dot", "font"].includes(mode)) {
      throw new Error(`Unknown glyph mode: ${mode}`);
    }
    if (mode === this.glyphMode) return;

    this.glyphMode = mode;
    this.rebuildAtlas();
    if (this.initialized) this.render(0);
  }

  setDotShape(shape = "round") {
    if (!["round", "square"].includes(shape)) {
      throw new Error(`Unknown dot shape: ${shape}`);
    }
    if (shape === this.dotShape) return;

    this.dotShape = shape;
    if (this.glyphMode === "dot") {
      this.rebuildAtlas();
      if (this.initialized) this.render(0);
    }
  }

  setQuietZone(options) {
    if (this.destroyed) return;

    const next =
      typeof options === "boolean"
        ? { ...this.quietZone, enabled: options }
        : { ...this.quietZone, ...options };

    for (const key of ["x", "y", "strength"]) {
      if (!Number.isFinite(next[key]) || next[key] < 0 || next[key] > 1) {
        throw new Error(`${key} must be between 0 and 1`);
      }
    }
    for (const key of ["radiusX", "radiusY"]) {
      if (!Number.isFinite(next[key]) || next[key] <= 0) {
        throw new Error(`${key} must be greater than 0`);
      }
    }

    this.quietZone = next;
    if (this.quietMask) {
      this.rebuildQuietMask();
      this.render(0);
    }
  }

  allocate() {
    const field = () => new Float32Array(this.size);
    this.u = field();
    this.v = field();
    this.u0 = field();
    this.v0 = field();
    this.dye = field();
    this.dye0 = field();
    this.pressure = field();
    this.divergence = field();
    this.psi = field();
    this.targetFX = field();
    this.targetFY = field();
    this.forceX = field();
    this.forceY = field();
    this.dyeSource = field();
    this.visualDye = field();
    this.visualSpeed = field();
    this.quietMask = field();
  }

  rebuildQuietMask() {
    if (!this.quietMask) return;
    this.quietMask.fill(1);
    if (!this.quietZone.enabled) return;

    const q = this.quietZone;
    const { nx, ny, stride, quietMask } = this;

    for (let y = 1; y <= ny; y += 1) {
      const row = y * stride;
      for (let x = 1; x <= nx; x += 1) {
        const dx = ((x - 0.5) / nx - q.x) / q.radiusX;
        const dy = ((y - 0.5) / ny - q.y) / q.radiusY;
        const influence = Math.exp(-2 * (dx * dx + dy * dy));
        quietMask[row + x] = 1 - q.strength * influence;
      }
    }
  }

  rebuildAtlas() {
    if (!this.initialized && !this.fontSize) return;
    this.atlas.rebuild({
      style: this.style,
      palette: this.palette,
      glyphs: this.glyphs,
      fontSize: this.fontSize,
      dpr: this.dpr,
      quality: this.quality,
      glyphMode: this.glyphMode,
      dotShape: this.dotShape,
    });
  }

  boundary(type, field) {
    const { nx, ny, stride } = this;

    for (let y = 1; y <= ny; y += 1) {
      const row = y * stride;
      field[row] = (type === 1 ? -1 : 1) * field[row + 1];
      field[row + nx + 1] = (type === 1 ? -1 : 1) * field[row + nx];
    }

    for (let x = 1; x <= nx; x += 1) {
      field[x] = (type === 2 ? -1 : 1) * field[stride + x];
      field[(ny + 1) * stride + x] =
        (type === 2 ? -1 : 1) * field[ny * stride + x];
    }

    field[0] = 0.5 * (field[1] + field[stride]);
    field[nx + 1] = 0.5 * (field[nx] + field[stride + nx + 1]);
    field[(ny + 1) * stride] =
      0.5 * (field[ny * stride] + field[(ny + 1) * stride + 1]);
    field[(ny + 1) * stride + nx + 1] =
      0.5 * (field[ny * stride + nx + 1] + field[(ny + 1) * stride + nx]);
  }

  diffuse(type, out, source, rate, dt) {
    const { nx, ny, stride } = this;
    const a = rate * dt;
    const denominator = 1 + 4 * a;
    out.set(source);

    for (
      let iteration = 0;
      iteration < this.quality.diffusionIterations;
      iteration += 1
    ) {
      for (let y = 1; y <= ny; y += 1) {
        const row = y * stride;
        for (let x = 1; x <= nx; x += 1) {
          const i = row + x;
          out[i] =
            (source[i] +
              a *
                (out[i - 1] + out[i + 1] + out[i - stride] + out[i + stride])) /
            denominator;
        }
      }
      this.boundary(type, out);
    }
  }

  project(vx, vy) {
    const { nx, ny, stride, pressure, divergence } = this;
    pressure.fill(0);

    for (let y = 1; y <= ny; y += 1) {
      const row = y * stride;
      for (let x = 1; x <= nx; x += 1) {
        const i = row + x;
        divergence[i] =
          -0.5 * (vx[i + 1] - vx[i - 1] + vy[i + stride] - vy[i - stride]);
      }
    }

    this.boundary(0, divergence);
    this.boundary(0, pressure);

    for (
      let iteration = 0;
      iteration < this.quality.pressureIterations;
      iteration += 1
    ) {
      for (let y = 1; y <= ny; y += 1) {
        const row = y * stride;
        for (let x = 1; x <= nx; x += 1) {
          const i = row + x;
          pressure[i] =
            0.25 *
            (divergence[i] +
              pressure[i - 1] +
              pressure[i + 1] +
              pressure[i - stride] +
              pressure[i + stride]);
        }
      }
      this.boundary(0, pressure);
    }

    for (let y = 1; y <= ny; y += 1) {
      const row = y * stride;
      for (let x = 1; x <= nx; x += 1) {
        const i = row + x;
        vx[i] -= 0.5 * (pressure[i + 1] - pressure[i - 1]);
        vy[i] -= 0.5 * (pressure[i + stride] - pressure[i - stride]);
      }
    }

    this.boundary(1, vx);
    this.boundary(2, vy);
  }

  advect(type, out, source, vx, vy, dt) {
    const { nx, ny, stride } = this;

    for (let y = 1; y <= ny; y += 1) {
      const row = y * stride;
      for (let x = 1; x <= nx; x += 1) {
        const i = row + x;
        const px = clamp(x - dt * vx[i], 0.5, nx + 0.5);
        const py = clamp(y - dt * vy[i], 0.5, ny + 0.5);
        const x0 = Math.floor(px);
        const y0 = Math.floor(py);
        const sx = px - x0;
        const sy = py - y0;
        const base = x0 + y0 * stride;

        out[i] =
          (1 - sx) * ((1 - sy) * source[base] + sy * source[base + stride]) +
          sx * ((1 - sy) * source[base + 1] + sy * source[base + stride + 1]);
      }
    }

    this.boundary(type, out);
  }

  createWaves() {
    this.waves = Array.from({ length: this.config.waveCount }, () => {
      const angle = this.range(-Math.PI, Math.PI);
      return {
        x: this.range(0.15, 0.85),
        y: this.range(0.15, 0.85),
        cos: Math.cos(angle),
        sin: Math.sin(angle),
        wavelength: this.unit * this.range(0.3, 0.65),
        width: this.unit * this.range(0.16, 0.3),
        length: this.unit * this.range(0.45, 0.85),
        phase: this.range(0, TAU),
        omega: this.range(0.65, 1.15),
        amplitude: this.range(0.7, 1.15),
        driftPhase: this.range(0, TAU),
        driftSpeed: this.range(0.08, 0.17),
      };
    });
  }

  rebuildWaveCache() {
    const { nx, ny, stride, psi, targetFX, targetFY, dyeSource } = this;
    psi.fill(0);
    targetFX.fill(0);
    targetFY.fill(0);
    dyeSource.fill(0);

    for (const wave of this.waves) {
      const drift = this.time * wave.driftSpeed + wave.driftPhase;
      const cx = nx * (wave.x + 0.07 * Math.sin(drift));
      const cy = ny * (wave.y + 0.07 * Math.cos(drift * 0.83));
      const k = TAU / wave.wavelength;
      const invLength = 1 / wave.length;
      const invWidth = 1 / wave.width;
      const amplitude = (this.config.waveStrength * wave.amplitude) / k;

      for (let y = 0; y <= ny + 1; y += 1) {
        const dy = y - cy;
        const row = y * stride;
        for (let x = 0; x <= nx + 1; x += 1) {
          const dx = x - cx;
          const along = dx * wave.cos + dy * wave.sin;
          const across = -dx * wave.sin + dy * wave.cos;
          const a = along * invLength;
          const b = across * invWidth;
          const distance2 = a * a + b * b;
          if (distance2 > 18) continue;

          const envelope = Math.exp(-0.5 * distance2);
          const phase = k * along + wave.phase;
          const oscillation = Math.sin(phase) + 0.18 * Math.sin(phase * 2 + b);
          const i = row + x;
          psi[i] += amplitude * envelope * oscillation;
          const crest = Math.max(0, Math.cos(phase));
          dyeSource[i] += this.config.waveDye * envelope * crest ** 6;
        }
      }
    }

    for (let y = 1; y <= ny; y += 1) {
      const row = y * stride;
      for (let x = 1; x <= nx; x += 1) {
        const i = row + x;
        targetFX[i] = 0.5 * (psi[i + stride] - psi[i - stride]);
        targetFY[i] = -0.5 * (psi[i + 1] - psi[i - 1]);
      }
    }
  }

  applyCachedWaves(dt) {
    for (const wave of this.waves)
      wave.phase = (wave.phase - wave.omega * dt) % TAU;

    this.waveCacheElapsed += dt;
    if (this.waveCacheElapsed >= this.waveInterval) {
      this.waveCacheElapsed %= this.waveInterval;
      this.rebuildWaveCache();
    }

    const follow = 1 - Math.exp(-this.config.waveForceResponse * dt);
    const drag = Math.exp(-this.config.drag * dt);
    const {
      nx,
      ny,
      stride,
      forceX,
      forceY,
      targetFX,
      targetFY,
      dyeSource,
      u,
      v,
      dye,
    } = this;

    for (let y = 1; y <= ny; y += 1) {
      const row = y * stride;
      for (let x = 1; x <= nx; x += 1) {
        const i = row + x;
        forceX[i] += (targetFX[i] - forceX[i]) * follow;
        forceY[i] += (targetFY[i] - forceY[i]) * follow;
        u[i] = (u[i] + forceX[i] * dt) * drag;
        v[i] = (v[i] + forceY[i] * dt) * drag;
        dye[i] = Math.min(3, dye[i] + dyeSource[i] * dt);
      }
    }
  }

  splat(cx, cy, fx, fy, amount, radius) {
    const x0 = Math.max(1, Math.floor(cx - radius * 2));
    const x1 = Math.min(this.nx, Math.ceil(cx + radius * 2));
    const y0 = Math.max(1, Math.floor(cy - radius * 2));
    const y1 = Math.min(this.ny, Math.ceil(cy + radius * 2));
    const invR2 = 1 / (radius * radius);

    for (let y = y0; y <= y1; y += 1) {
      const row = y * this.stride;
      for (let x = x0; x <= x1; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        const weight = Math.exp(-(dx * dx + dy * dy) * invR2);
        const i = row + x;
        this.u[i] += fx * weight;
        this.v[i] += fy * weight;
        this.dye[i] = Math.min(3, this.dye[i] + amount * weight);
      }
    }
  }

  applyRipples(dt) {
    const now = this.time;
    this.ripples = this.ripples.filter(
      (ripple) => now - ripple.birth < this.config.rippleLifetime,
    );

    for (const ripple of this.ripples) {
      const age = now - ripple.birth;
      const radius = age * this.unit * 0.22;
      const width = this.unit * 0.075;
      const width2 = width * width;
      const k = TAU / (this.unit * 0.18);
      const fade = Math.exp(-age * 0.85);
      const amplitude = (this.config.rippleStrength * fade) / k;
      const reach = radius + width * 3;
      const x0 = Math.max(1, Math.floor(ripple.x - reach));
      const x1 = Math.min(this.nx, Math.ceil(ripple.x + reach));
      const y0 = Math.max(1, Math.floor(ripple.y - reach));
      const y1 = Math.min(this.ny, Math.ceil(ripple.y + reach));

      for (let y = y0; y <= y1; y += 1) {
        const row = y * this.stride;
        for (let x = x0; x <= x1; x += 1) {
          const dx = x - ripple.x;
          const dy = y - ripple.y;
          const r2 = dx * dx + dy * dy;
          const r = Math.sqrt(r2);
          const q = r - radius;
          if (Math.abs(q) > width * 3) continue;

          const envelope = Math.exp((-0.5 * q * q) / width2);
          const phase = k * q;
          const derivative =
            amplitude *
            envelope *
            (k * Math.cos(phase) - (q / width2) * Math.sin(phase)) *
            ripple.direction;
          const i = row + x;

          if (r > 0.001) {
            this.u[i] += (derivative * dy * dt) / r;
            this.v[i] -= (derivative * dx * dt) / r;
          }
          this.dye[i] = Math.min(3, this.dye[i] + envelope * fade * 0.3 * dt);
        }
      }
    }
  }

  applyPointer(dt) {
    const p = this.pointer;
    if (!p.down) return;

    this.splat(
      1 + (p.x / this.W) * (this.nx - 1),
      1 + (p.y / this.H) * (this.ny - 1),
      clamp(p.vx / this.cellW, -65, 65) * dt * this.config.pointerForce,
      clamp(p.vy / this.cellH, -65, 65) * dt * this.config.pointerForce,
      this.config.pointerDye * dt,
      Math.max(2, this.unit * 0.045),
    );

    const fade = Math.exp(-12 * dt);
    p.vx *= fade;
    p.vy *= fade;
  }

  simulate(dt) {
    this.applyCachedWaves(dt);
    this.applyRipples(dt);
    this.applyPointer(dt);

    this.boundary(1, this.u);
    this.boundary(2, this.v);
    this.boundary(0, this.dye);

    this.diffuse(1, this.u0, this.u, this.config.viscosity, dt);
    this.diffuse(2, this.v0, this.v, this.config.viscosity, dt);
    this.project(this.u0, this.v0);

    this.advect(1, this.u, this.u0, this.u0, this.v0, dt);
    this.advect(2, this.v, this.v0, this.u0, this.v0, dt);
    this.project(this.u, this.v);

    this.diffuse(0, this.dye0, this.dye, this.config.diffusion, dt);
    this.advect(0, this.dye, this.dye0, this.u, this.v, dt);

    const fade = Math.exp(-this.config.decay * dt);
    for (let i = 0; i < this.size; i += 1) this.dye[i] *= fade;
  }

  initialize() {
    if (!this.u) return;

    this.seed = this.currentSeed;
    this.time = 0;
    this.waveCacheElapsed = 0;
    this.accumulator = 0;
    this.lastTime = 0;
    this.lastRenderTime = 0;
    this.ripples = [];
    this.clearPointer();

    for (const field of [
      this.u,
      this.v,
      this.u0,
      this.v0,
      this.dye,
      this.dye0,
      this.visualDye,
      this.visualSpeed,
      this.forceX,
      this.forceY,
    ]) {
      field.fill(0);
    }

    this.createWaves();

    for (let n = 0; n < this.config.cloudCount; n += 1) {
      const cx = this.nx * this.range(0.08, 0.92);
      const cy = this.ny * this.range(0.1, 0.9);
      const angle = this.range(0, TAU);
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const rx = this.unit * this.range(0.13, 0.32);
      const ry = this.unit * this.range(0.045, 0.13);
      const amplitude = this.range(0.45, 1.25);
      const phase = this.range(0, TAU);
      const bend = this.range(0.2, 0.7);
      const reach = 3 * Math.max(rx, ry);
      const x0 = Math.max(1, Math.floor(cx - reach));
      const x1 = Math.min(this.nx, Math.ceil(cx + reach));
      const y0 = Math.max(1, Math.floor(cy - reach));
      const y1 = Math.min(this.ny, Math.ceil(cy + reach));

      for (let y = y0; y <= y1; y += 1) {
        const row = y * this.stride;
        for (let x = x0; x <= x1; x += 1) {
          const dx = x - cx;
          const dy = y - cy;
          const along = (dx * c + dy * s) / rx;
          let across = (-dx * s + dy * c) / ry;
          across += bend * Math.sin(along * 2.4 + phase);
          const envelope = Math.exp(-1.8 * (along * along + across * across));
          const texture =
            0.75 + 0.25 * Math.cos(along * 5.5 + across * 2 + phase);
          this.dye[row + x] += amplitude * envelope * texture;
        }
      }
    }

    for (let i = 0; i < this.size; i += 1)
      this.dye[i] = Math.min(this.dye[i], 2);

    this.rebuildWaveCache();
    this.forceX.set(this.targetFX);
    this.forceY.set(this.targetFY);

    for (let i = 0; i < this.size; i += 1) {
      this.u[i] = this.forceX[i] * 0.8;
      this.v[i] = this.forceY[i] * 0.8;
    }

    this.boundary(1, this.u);
    this.boundary(2, this.v);
    this.boundary(0, this.dye);
    this.project(this.u, this.v);

    for (let n = 0; n < this.config.warmupSteps; n += 1) {
      this.time += this.step;
      this.simulate(this.step);
    }

    for (let i = 0; i < this.size; i += 1) {
      this.visualDye[i] = this.dye[i];
      this.visualSpeed[i] = Math.hypot(this.u[i], this.v[i]);
    }

    this.initialized = true;
    this.rebuildAtlas();
    this.render(0);
    this.schedule();
  }

  regenerate(seed) {
    if (this.destroyed) return;
    this.currentSeed = Number.isFinite(seed) ? seed >>> 0 : makeSeed();
    this.initialize();
  }

  render(dt) {
    if (!this.initialized || !this.atlas.ready) return;

    const { ctx, dpr, W, H, nx, ny, stride, cellW, cellH, style, quietMask } =
      this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = style.background;
    ctx.fillRect(0, 0, W, H);

    const smoothing =
      dt > 0 ? 1 - Math.exp(-this.config.visualResponse * dt) : 1;
    const maxChar = this.glyphs.length - 1;
    const scaleRange = style.scaleMax - style.scaleMin;

    for (let y = 1; y <= ny; y += 1) {
      const row = y * stride;
      const centerY = (y - 0.5) * cellH;
      for (let x = 1; x <= nx; x += 1) {
        const i = row + x;
        this.visualDye[i] += (this.dye[i] - this.visualDye[i]) * smoothing;
        const speed = Math.hypot(this.u[i], this.v[i]);
        this.visualSpeed[i] += (speed - this.visualSpeed[i]) * smoothing;

        const density = 1 - Math.exp(-this.visualDye[i] * style.densityGain);
        if (density < 0.025) continue;
        const motion = 1 - Math.exp(-this.visualSpeed[i] * style.motionGain);
        const colorValue = mix(density, motion, style.colorMotionMix);
        const sizeValue = mix(density, motion, style.sizeMotionMix);
        const glyphIndex = clamp(Math.floor(density * maxChar), 1, maxChar);
        const visibility = clamp((density - 0.025) / 0.14, 0, 1);
        const alpha = style.opacity * visibility * quietMask[i];
        if (alpha < 0.012) continue;

        const sprite = this.atlas.sprite(glyphIndex, colorValue);
        const centerX = (x - 0.5) * cellW;
        const glyphScale =
          style.scaleMin + Math.pow(sizeValue, style.sizeExponent) * scaleRange;
        const drawSize = this.atlas.tileCss * (glyphScale / style.scaleMax);
        const halfDrawSize = drawSize * 0.5;

        ctx.globalAlpha = alpha;
        ctx.drawImage(
          this.atlas.canvas,
          sprite.sx,
          sprite.sy,
          sprite.sw,
          sprite.sh,
          centerX - halfDrawSize,
          centerY - halfDrawSize,
          drawSize,
          drawSize,
        );
      }
    }

    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  sample(field, x, y, old) {
    x = clamp(x, 1, old.nx);
    y = clamp(y, 1, old.ny);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, old.nx);
    const y1 = Math.min(y0 + 1, old.ny);
    const tx = x - x0;
    const ty = y - y0;
    const base = x0 + y0 * old.stride;
    const right = x1 + y0 * old.stride;
    const bottom = x0 + y1 * old.stride;
    const bottomRight = x1 + y1 * old.stride;
    return mix(
      mix(field[base], field[right], tx),
      mix(field[bottom], field[bottomRight], tx),
      ty,
    );
  }

  resize(
    width,
    height,
    dpr = globalThis.devicePixelRatio || 1,
    forceGrid = false,
  ) {
    if (this.destroyed) return;

    const newW = Math.max(0, Math.floor(width));
    const newH = Math.max(0, Math.floor(height));
    if (newW < 2 || newH < 2) return;

    const newDpr = clamp(Number(dpr) || 1, 1, 2);
    const newNx = clamp(
      Math.ceil(newW / this.quality.cellWidth),
      32,
      this.quality.maxCols,
    );
    const newNy = clamp(
      Math.ceil(newH / this.quality.cellHeight),
      24,
      this.quality.maxRows,
    );
    const firstRun = !this.u;

    if (
      !forceGrid &&
      !firstRun &&
      this.W === newW &&
      this.H === newH &&
      this.dpr === newDpr &&
      this.nx === newNx &&
      this.ny === newNy
    ) {
      return;
    }

    const old = firstRun
      ? null
      : {
          nx: this.nx,
          ny: this.ny,
          stride: this.stride,
          unit: this.unit,
          u: this.u,
          v: this.v,
          dye: this.dye,
          visualDye: this.visualDye,
          visualSpeed: this.visualSpeed,
          forceX: this.forceX,
          forceY: this.forceY,
        };

    const gridChanged =
      firstRun || forceGrid || this.nx !== newNx || this.ny !== newNy;

    this.W = newW;
    this.H = newH;
    this.dpr = newDpr;
    this.nx = newNx;
    this.ny = newNy;
    this.stride = this.nx + 2;
    this.size = this.stride * (this.ny + 2);
    this.cellW = this.W / this.nx;
    this.cellH = this.H / this.ny;
    this.unit = Math.min(this.nx, this.ny);
    this.fontSize = Math.min(this.cellH * 0.9, this.cellW * 1.6);

    this.canvas.width = Math.max(1, Math.round(this.W * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.H * this.dpr));

    if (gridChanged) this.allocate();
    this.rebuildQuietMask();

    if (firstRun) {
      this.initialize();
      return;
    }

    if (gridChanged && old) {
      const sx = this.nx / old.nx;
      const sy = this.ny / old.ny;
      const speedScale = Math.sqrt(sx * sy);

      for (let y = 1; y <= this.ny; y += 1) {
        const row = y * this.stride;
        for (let x = 1; x <= this.nx; x += 1) {
          const ox = ((x - 0.5) / this.nx) * old.nx + 0.5;
          const oy = ((y - 0.5) / this.ny) * old.ny + 0.5;
          const i = row + x;
          this.u[i] = this.sample(old.u, ox, oy, old) * sx;
          this.v[i] = this.sample(old.v, ox, oy, old) * sy;
          this.dye[i] = this.sample(old.dye, ox, oy, old);
          this.forceX[i] = this.sample(old.forceX, ox, oy, old) * sx;
          this.forceY[i] = this.sample(old.forceY, ox, oy, old) * sy;
          this.visualDye[i] = this.sample(old.visualDye, ox, oy, old);
          this.visualSpeed[i] =
            this.sample(old.visualSpeed, ox, oy, old) * speedScale;
        }
      }

      const waveScale = this.unit / old.unit;
      for (const wave of this.waves) {
        wave.wavelength *= waveScale;
        wave.width *= waveScale;
        wave.length *= waveScale;
      }
      for (const ripple of this.ripples) {
        ripple.x =
          1 + ((ripple.x - 1) / Math.max(1, old.nx - 1)) * (this.nx - 1);
        ripple.y =
          1 + ((ripple.y - 1) / Math.max(1, old.ny - 1)) * (this.ny - 1);
      }

      this.boundary(1, this.u);
      this.boundary(2, this.v);
      this.boundary(0, this.dye);
      this.project(this.u, this.v);
      this.rebuildWaveCache();
      this.waveCacheElapsed = 0;
    }

    this.clearPointer();
    this.accumulator = 0;
    this.lastTime = 0;
    this.lastRenderTime = 0;
    this.rebuildAtlas();
    this.render(0);
    this.schedule();
  }

  clearPointer() {
    this.pointer.down = false;
    this.pointer.id = null;
    this.pointer.vx = 0;
    this.pointer.vy = 0;
    this.pointer.lastRipple = -Infinity;
  }

  pointerPosition(event, rect) {
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    };
  }

  addRipple(x, y) {
    if (!this.initialized || this.W <= 0 || this.H <= 0) return;
    this.ripples.push({
      x: 1 + (x / this.W) * (this.nx - 1),
      y: 1 + (y / this.H) * (this.ny - 1),
      birth: this.time,
      direction: this.random() > 0.5 ? 1 : -1,
    });
    if (this.ripples.length > this.config.maxRipples) this.ripples.shift();
  }

  pointerDown(event, rect) {
    if (this.paused || this.destroyed || !this.initialized) return false;
    if (!event.isPrimary || event.button !== 0) return false;

    const now = performance.now();
    const p = this.pointerPosition(event, rect);
    this.pointer.down = true;
    this.pointer.id = event.pointerId;
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    this.pointer.vx = 0;
    this.pointer.vy = 0;
    this.pointer.last = now;
    this.pointer.lastRipple = now;
    this.addRipple(p.x, p.y);
    return true;
  }

  pointerMove(event, rect) {
    if (!this.pointer.down || event.pointerId !== this.pointer.id) return;
    if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
      this.clearPointer();
      return;
    }

    const now = performance.now();
    const p = this.pointerPosition(event, rect);
    const elapsed = Math.max((now - this.pointer.last) / 1000, 1 / 120);
    const dx = p.x - this.pointer.x;
    const dy = p.y - this.pointer.y;
    this.pointer.vx = dx / elapsed;
    this.pointer.vy = dy / elapsed;
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    this.pointer.last = now;

    if (
      now - this.pointer.lastRipple > this.config.rippleInterval &&
      Math.hypot(dx, dy) > 1
    ) {
      this.addRipple(p.x, p.y);
      this.pointer.lastRipple = now;
    }
  }

  pointerUp(event) {
    if (event.pointerId === this.pointer.id) this.clearPointer();
  }

  isRunnable() {
    return (
      !this.destroyed &&
      !this.paused &&
      this.suspensions.size === 0 &&
      this.initialized
    );
  }

  schedule() {
    if (!this.frameId && this.isRunnable()) {
      this.frameId = requestAnimationFrame(this._frame);
    }
  }

  frame(now) {
    this.frameId = 0;
    if (!this.isRunnable()) return;

    if (
      this.lastRenderTime &&
      now - this.lastRenderTime < this.renderIntervalMs - 1
    ) {
      this.schedule();
      return;
    }

    const elapsed = this.lastTime
      ? Math.min((now - this.lastTime) / 1000, 0.1)
      : this.step;
    this.lastTime = now;
    this.lastRenderTime = now;
    this.accumulator = Math.min(
      this.accumulator + elapsed,
      this.step * this.config.maxSubsteps,
    );

    let steps = 0;
    // Keep scheduling/smoothing in wall time, but evolve the fluid more slowly.
    // Scaling the whole physical step also slows advection and numerical
    // diffusion; reducing dye decay alone would still erase the glyph shapes.
    const simulationDt = this.step * this.config.timeScale;
    while (this.accumulator >= this.step && steps < this.config.maxSubsteps) {
      this.time += simulationDt;
      this.simulate(simulationDt);
      this.accumulator -= this.step;
      steps += 1;
    }

    this.render(elapsed);
    this.schedule();
  }

  pause() {
    if (this.destroyed) return;
    this.paused = true;
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.clearPointer();
    this.accumulator = 0;
    this.lastTime = 0;
  }

  resume() {
    if (this.destroyed) return;
    this.paused = false;
    this.accumulator = 0;
    this.lastTime = 0;
    this.schedule();
  }

  suspend(reason, suspended = true) {
    if (suspended) this.suspensions.add(reason);
    else this.suspensions.delete(reason);

    if (this.suspensions.size > 0) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
      this.clearPointer();
      this.accumulator = 0;
      this.lastTime = 0;
    } else {
      this.schedule();
    }
  }

  destroy() {
    if (this.destroyed) return;
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.destroyed = true;
    this.clearPointer();
    this.waves = [];
    this.ripples = [];
    this.u = this.v = this.u0 = this.v0 = null;
    this.dye = this.dye0 = this.pressure = this.divergence = null;
    this.psi = this.targetFX = this.targetFY = null;
    this.forceX = this.forceY = this.dyeSource = null;
    this.visualDye = this.visualSpeed = this.quietMask = null;
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

export { BASE_CONFIG, resolveQuality };
