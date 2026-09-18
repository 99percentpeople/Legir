export type HeroBackgroundStatus =
  | "loading"
  | "running"
  | "still"
  | "suspended"
  | "fallback";

export interface HeroBackgroundController {
  destroy: () => void;
}
