import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASCIIFluidEngine } from "../../www/src/components/hero-background/field/engine.js";
import { HERO_TIDE_CONFIG } from "../../www/src/components/hero-background/config";

// Use the real solver; only Canvas painting and browser scheduling are stubbed.
// Private field inspection keeps the regression about retained glyph structure,
// rather than just asserting that a decay constant happens to have changed.
type TestEngine = ASCIIFluidEngine & {
  time: number;
  dye: Float32Array;
  quietMask: Float32Array;
  frame: (now: number) => void;
  render: (dt: number) => void;
  simulate: (dt: number) => void;
};

const noop = () => {};
const context = {
  clearRect: noop,
  setTransform: noop,
  fillText: noop,
  beginPath: noop,
  arc: noop,
  fill: noop,
  fillRect: noop,
  drawImage: noop,
} as unknown as CanvasRenderingContext2D;

function textureSignal(engine: TestEngine) {
  let signal = 0;
  for (let i = 0; i < engine.dye.length; i++) {
    const density = 1 - Math.exp(-engine.dye[i] * 1.9);
    if (density > 0.2) signal += density * engine.quietMask[i];
  }
  return signal;
}

describe("hero fluid longevity", () => {
  let engine: TestEngine;
  beforeEach(() => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context,
    );
    engine = new ASCIIFluidEngine(document.createElement("canvas"), {
      theme: "paper",
      quality: "low",
      glyphMode: "dot",
      seed: 197806,
      paused: true,
      quietZone: {
        enabled: true,
        x: 0.5,
        y: 0.46,
        radiusX: 0.36,
        radiusY: 0.55,
        strength: 0.98,
      },
      config: HERO_TIDE_CONFIG,
    }) as TestEngine;
    engine.resize(1440, 507, 1);
  });
  afterEach(() => {
    engine.destroy();
    vi.unstubAllGlobals();
  });
  it("slows physical time while retaining the animation frame cadence", () => {
    const start = engine.time;
    const simulate = vi.spyOn(engine, "simulate").mockImplementation(noop);
    vi.spyOn(engine, "render").mockImplementation(noop);
    engine.resume();
    engine.frame(1000);
    engine.frame(1050);
    expect(simulate).toHaveBeenCalledTimes(2);
    expect(simulate.mock.calls.at(-1)?.[0]).toBeCloseTo(0.01);
    expect(engine.time - start).toBeCloseTo(0.02);
  });
  it("retains visible glyph structure at 5, 30, 60 and 120 seconds and keeps drifting", () => {
    const initial = textureSignal(engine);
    expect(initial).toBeGreaterThan(1);
    vi.spyOn(engine, "render").mockImplementation(noop);
    engine.resume();
    let previous = engine.dye.slice();
    for (let tick = 1; tick <= 2400; tick++) {
      engine.frame(1000 + tick * 50);
      if (![100, 600, 1200, 2400].includes(tick)) continue;
      const signal = textureSignal(engine);
      expect(signal).toBeGreaterThan(initial * 0.4);
      expect(signal).toBeLessThan(initial * 3);
      let change = 0;
      for (let i = 0; i < engine.dye.length; i++) {
        expect(Number.isFinite(engine.dye[i])).toBe(true);
        change += Math.abs(engine.dye[i] - previous[i]);
      }
      expect(change).toBeGreaterThan(1);
      previous = engine.dye.slice();
    }
  }, 15000);
  it("does not age the field or catch up hidden time when resumed", () => {
    vi.spyOn(engine, "render").mockImplementation(noop);
    engine.resume();
    engine.frame(1000);
    const beforePause = engine.time;
    engine.pause();
    engine.frame(120000);
    expect(engine.time).toBe(beforePause);
    engine.resume();
    engine.frame(240000);
    expect(engine.time - beforePause).toBeCloseTo(0.01);
  });
});
