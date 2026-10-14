import React, { useEffect, useState } from "react";
import { File } from "lucide-react";
import { renderThumbnail } from "@/services/pdfService/thumbnailRenderer";
import { cn } from "@/utils/cn";
import type { PageData } from "@/types";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import type { ThumbnailContent } from "@/services/pdfService/types";
import {
  getPageDisplayRotation,
  getPageView,
} from "@/components/workspace/lib/pageViewRotation";

export const PageThumbnail = React.memo(function PageThumbnail({
  page,
  worker,
  image,
  onImage,
  content,
  ref,
  unframed = false,
}: {
  page: PageData;
  worker: Pick<PDFWorkerService, "renderPageImage"> | null;
  image?: string;
  onImage?: (url: string) => boolean;
  content?: ThumbnailContent;
  ref?: React.Ref<HTMLDivElement>;
  unframed?: boolean;
}) {
  const [localImage, setLocalImage] = useState<string>();
  useEffect(() => {
    if (image || page.blank || !worker) return;
    const controller = new AbortController();
    let url: string | undefined;
    let retained = false;
    void renderThumbnail(worker, page.pageIndex, controller.signal, content)
      .then((result) => {
        if (controller.signal.aborted) {
          URL.revokeObjectURL(result);
          return;
        }
        url = result;
        retained = onImage?.(url) ?? false;
        setLocalImage(url);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      if (url && !retained) URL.revokeObjectURL(url);
    };
  }, [image, onImage, page.blank, page.pageIndex, worker, content]);
  const view = getPageView(page, 0);
  const src = image ?? localImage;
  return (
    <div
      ref={ref}
      data-page-thumbnail
      className={cn(
        "relative max-h-full max-w-full overflow-hidden border bg-white",
        unframed ? "border-transparent" : "shadow-sm",
      )}
      style={{
        width: view.width / view.height > 0.78 ? "100%" : undefined,
        height: view.width / view.height <= 0.78 ? "100%" : undefined,
        aspectRatio: view.width / view.height,
      }}
    >
      {src ? (
        <img
          alt=""
          draggable={false}
          src={src}
          className="absolute top-1/2 left-1/2 max-w-none object-contain"
          style={{
            width: `${(page.width / view.width) * 100}%`,
            height: `${(page.height / view.height) * 100}%`,
            transform: `translate(-50%, -50%) rotate(${getPageDisplayRotation(page, 0)}deg)`,
          }}
        />
      ) : (
        !page.blank && (
          <div className="text-muted-foreground flex h-full items-center justify-center">
            <File size={22} />
          </div>
        )
      )}
    </div>
  );
});
