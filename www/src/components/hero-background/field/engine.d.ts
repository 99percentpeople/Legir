/** Narrow typed boundary around the user-supplied JavaScript rendering core. */
export type ColorStop = [number, string];
export interface TidalStyle {
  background: string;
  chars: string;
  scaleMin: number;
  scaleMax: number;
  opacity: number;
  densityGain: number;
  motionGain: number;
  colorMotionMix: number;
  sizeMotionMix: number;
  sizeExponent: number;
  colors: ColorStop[];
}
export interface TidalOptions {
  theme?: "paper" | "mono";
  quality?: "low" | "medium";
  glyphMode?: "dot" | "font";
  dotShape?: "round" | "square";
  paused?: boolean;
  seed?: number;
  quietZone?: {
    enabled: boolean;
    x: number;
    y: number;
    radiusX: number;
    radiusY: number;
    strength: number;
  };
  config?: {
    simulationHz?: number;
    renderHz?: number;
    maxSubsteps?: number;
    timeScale?: number;
    decay?: number;
    waveCacheHz?: number;
    waveStrength?: number;
    waveDye?: number;
    visualResponse?: number;
    cloudCount?: number;
    warmupSteps?: number;
  };
}
export class ASCIIFluidEngine {
  constructor(canvas: HTMLCanvasElement, options?: TidalOptions);
  setStyle(style: Partial<TidalStyle>): void;
  resize(width: number, height: number, dpr?: number): void;
  pause(): void;
  resume(): void;
  destroy(): void;
}
