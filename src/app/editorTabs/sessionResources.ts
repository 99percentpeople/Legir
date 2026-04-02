import { revokeThumbnailObjectUrls } from "@/store/helpers";
import type { EditorTabSession } from "./types";

export const cloneEditorTabThumbnailImages = (
  thumbnailImages: Record<number, string>,
) => ({
  ...thumbnailImages,
});

export const disposeEditorTabSessionResources = (
  session:
    | Pick<
        EditorTabSession,
        "disposePdfResources" | "workerService" | "thumbnailImages"
      >
    | null
    | undefined,
) => {
  if (!session) return;

  session.disposePdfResources?.();
  revokeThumbnailObjectUrls(session.thumbnailImages);
  session.workerService.destroy();
};
