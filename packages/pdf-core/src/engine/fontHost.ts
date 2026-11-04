/** Only the host can access Tauri's system-font APIs. PDF work stays in its
 * worker; this narrow bridge requests immutable font bytes when needed. */
export type FontRequest = {
  families: string[];
  generic: "serif" | "sans-serif" | null;
};
type FontProvider = (request: FontRequest) => Promise<Uint8Array | undefined>;
let provider: FontProvider | undefined;
export const setWorkerFontProvider = (value: FontProvider) => {
  provider = value;
};
export const hasWorkerFontProvider = () => !!provider;
export const requestHostFont = (request: FontRequest) => provider?.(request);

export type FontHostRequest = {
  type: "fontRequest";
  id: string;
  request: FontRequest;
};
export type FontHostResponse = {
  type: "fontResponse";
  id: string;
  bytes?: Uint8Array;
};
