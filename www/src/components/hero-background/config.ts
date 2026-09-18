import type { TidalOptions } from "./field/engine.js";

/** Slow the scene's physical time, not its frame cadence. Retain a small dye
 * source so the opening clouds soften into a living texture, not a blank hero.
 * These are presentation parameters, not a second timer or a periodic reset.
 */
export const HERO_TIDE_CONFIG = Object.freeze({
  simulationHz: 20,
  renderHz: 24,
  maxSubsteps: 1,
  timeScale: 0.2,
  decay: 0.045,
  waveCacheHz: 10,
  waveStrength: 8,
  waveDye: 0.06,
  visualResponse: 5,
  cloudCount: 14,
  warmupSteps: 6,
} satisfies NonNullable<TidalOptions["config"]>);
