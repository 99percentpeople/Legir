/** Navigation is window-local; a document ID is not a persistent file URL. */
export type WorkspacePage =
  | { kind: "home" }
  | { kind: "document"; tabId: string };

export interface WorkspaceNavigationOptions {
  replace?: boolean;
  skipCaptureCurrent?: boolean;
}
