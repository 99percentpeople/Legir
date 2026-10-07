import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type RefObject,
} from "react";
import { toast } from "sonner";
import { useLanguage } from "@/components/language-provider";
import { useEditorTabRuntime } from "@/app/editorTabs/context";
import { useEventListeners } from "@/hooks/useEventListener";
import { canPerformPdfPermissionOperation } from "@/lib/pdfPermissions";
import {
  createStampImageResource,
  hasStampImageTransfer,
  isStampImageFile,
  loadStampImageFile,
  STAMP_LIBRARY_DRAG_TYPE,
} from "@/lib/stampImage";
import { getStampRectAtPoint } from "@/lib/stamps";
import { useStampLibraryStore } from "@/store/stampLibraryStore";
import type {
  Annotation,
  StampImageResource,
  WorkspaceEditorState,
} from "@/types";

export const useWorkspaceStampDrop = (options: {
  containerRef: RefObject<HTMLDivElement | null>;
  editorStateRef: RefObject<WorkspaceEditorState>;
  getPageIndexFromPoint: (x: number, y: number) => number | null;
  getRelativeCoordsFromPoint: (
    x: number,
    y: number,
    pageIndex: number,
  ) => { x: number; y: number };
  onAddAnnotation: (annotation: Annotation) => void;
}) => {
  const { t } = useLanguage();
  const runtime = useEditorTabRuntime();
  const mounted = useRef(true);
  const [dropPageIndex, setDropPageIndex] = useState<number | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const canDrop = () => {
    const state = options.editorStateRef.current;
    return (
      mounted.current &&
      (!runtime || (runtime.active && !runtime.disposed)) &&
      state.documentLoadState === "ready" &&
      canPerformPdfPermissionOperation(
        "edit_annotation",
        state.documentPermissions,
      )
    );
  };

  useEventListeners(typeof window === "undefined" ? null : window, {
    drop: () => setDropPageIndex(null),
    dragend: () => setDropPageIndex(null),
  });

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasStampImageTransfer(event.dataTransfer)) return;
    event.preventDefault();
    const pageIndex = canDrop()
      ? options.getPageIndexFromPoint(event.clientX, event.clientY)
      : null;
    event.dataTransfer.dropEffect = pageIndex === null ? "none" : "copy";
    setDropPageIndex(pageIndex);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    setDropPageIndex(null);
    if (!hasStampImageTransfer(event.dataTransfer)) return;
    event.preventDefault();
    if (!canDrop()) return;
    const pageIndex = options.getPageIndexFromPoint(
      event.clientX,
      event.clientY,
    );
    if (pageIndex === null) return;
    const state = options.editorStateRef.current;
    const page = state.pages.find((item) => item.pageIndex === pageIndex);
    if (!page) return;
    // Capture the target before decoding. Tab switches must never retarget a drop.
    const point = options.getRelativeCoordsFromPoint(
      event.clientX,
      event.clientY,
      pageIndex,
    );
    const scale = state.scale;
    const viewportWidth = options.containerRef.current?.clientWidth;
    const viewportHeight = options.containerRef.current?.clientHeight;
    const files = Array.from(event.dataTransfer.files).filter(isStampImageFile);
    const entryId = event.dataTransfer.getData(STAMP_LIBRARY_DRAG_TYPE);
    const entry = useStampLibraryStore
      .getState()
      .entries.find((item) => item.id === entryId);
    const place = (image: StampImageResource, offset: number) => {
      if (!canDrop() || !options.editorStateRef.current.pages.includes(page))
        return false;
      options.onAddAnnotation({
        id: `stamp_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type: "stamp",
        pageIndex,
        rect: getStampRectAtPoint(
          { x: point.x + offset / scale, y: point.y + offset / scale },
          {
            kind: "image",
            imageWidth: image.intrinsicSize?.width,
            imageHeight: image.intrinsicSize?.height,
            scale,
            viewportWidth,
            viewportHeight,
            pageWidth: page.width,
            pageHeight: page.height,
          },
        ),
        stamp: { kind: "image", image, appearance: { frame: "plain" } },
        opacity: 1,
      });
      return true;
    };
    if (entry) {
      if (place(entry.image, 0)) {
        void useStampLibraryStore
          .getState()
          .markUsed(entry.id)
          .catch(() => toast.error(t("stamp.library_save_error")));
      }
      return;
    }
    void (async () => {
      for (const [index, file] of files.entries()) {
        let image: StampImageResource;
        try {
          image = createStampImageResource(await loadStampImageFile(file))!;
        } catch {
          toast.error(t("stamp.upload_error"));
          continue;
        }
        place(image, index * 16);
        try {
          await useStampLibraryStore.getState().add(file.name, image, file);
        } catch {
          toast.error(t("stamp.library_save_error"));
        }
      }
    })();
  };

  return {
    dropPageIndex,
    handlers: {
      onDragOver,
      onDrop,
      onDragLeave: (event: DragEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDropPageIndex(null);
      },
    },
  };
};
