import { revokeThumbnailObjectUrls } from "@/store/helpers";
import type { EditorTabSession } from "./types";

export const disposeEditorTabSessionResources = (
  session: EditorTabSession | null | undefined,
) => {
  if (!session || session.runtime.disposed) return;
  const thumbnails = session.runtime.store.resources.getState().thumbnailImages;
  session.runtime.dispose();
  session.disposePdfResources?.();
  revokeThumbnailObjectUrls(thumbnails);
  session.workerService.destroy();
};
