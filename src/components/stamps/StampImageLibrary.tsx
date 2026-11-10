import React from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import {
  ImageUploadField,
  type ImageUploadContext,
} from "@/components/ui/image-upload-field";
import { useStampLibraryStore } from "@/store/stampLibraryStore";
import { createStampImageResource } from "@legir/pdf-model/stampImage";
import {
  isStampImageFile,
  loadStampImageFile,
  STAMP_IMAGE_ACCEPT,
  STAMP_LIBRARY_DRAG_TYPE,
} from "@/lib/stampImageBrowser";
import type { StampImageResource } from "@/types";
import { cn } from "@/utils/cn";

interface StampImageLibraryProps {
  image?: StampImageResource;
  onSelect: (image: StampImageResource) => void;
  selectionKey?: string;
}

/** Stamp-specific persistence and selection; upload interactions are shared with buttons. */
export const StampImageLibrary = ({
  image,
  onSelect,
  selectionKey,
}: StampImageLibraryProps) => {
  const { t } = useLanguage();
  const { entries, refresh, add, remove } = useStampLibraryStore();

  React.useEffect(() => {
    void refresh().catch(() => toast.error(t("stamp.library_load_error")));
  }, [refresh, t]);

  const importFiles = async (files: File[], { signal }: ImageUploadContext) => {
    let selected: StampImageResource | undefined;
    for (const file of files) {
      if (signal.aborted) return;
      if (!isStampImageFile(file)) {
        toast.error(t("stamp.import_error", { name: file.name }));
        continue;
      }
      try {
        const asset = await loadStampImageFile(file);
        if (signal.aborted) return;
        const resource = createStampImageResource(asset)!;
        await add(file.name, resource, file);
        selected ??= resource;
      } catch {
        if (!signal.aborted)
          toast.error(t("stamp.import_error", { name: file.name }));
      }
    }
    if (selected && !signal.aborted) onSelect(selected);
  };

  const unsavedImage =
    image?.dataUrl &&
    !entries.some((entry) => entry.image.dataUrl === image.dataUrl);

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{t("stamp.custom_images")}</div>
      <p className="text-muted-foreground text-xs">{t("stamp.library_hint")}</p>
      <ImageUploadField
        imageData={image?.dataUrl}
        alt={t("properties.image_stamp")}
        accept={STAMP_IMAGE_ACCEPT}
        multiple
        selectionKey={selectionKey}
        uploadLabel={t("stamp.add_images")}
        replaceLabel={t("stamp.add_images")}
        onUpload={importFiles}
        onUploadError={() => toast.error(t("stamp.upload_error"))}
      >
        {entries.length > 0 && (
          <div className="grid max-h-60 grid-cols-3 gap-2 overflow-y-auto p-1">
            {entries.map((entry) => (
              <div key={entry.id} className="group relative min-w-0">
                <button
                  type="button"
                  draggable
                  title={entry.name}
                  aria-label={entry.name}
                  aria-pressed={image?.dataUrl === entry.image.dataUrl}
                  className={cn(
                    "border-input bg-muted/20 focus-visible:ring-ring flex h-20 w-full items-center justify-center rounded-md border p-2 focus-visible:ring-2",
                    image?.dataUrl === entry.image.dataUrl &&
                      "border-primary ring-primary ring-1",
                  )}
                  onClick={() => onSelect(entry.image)}
                  onDragStart={(event) => {
                    if (event.currentTarget.matches(":disabled")) {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(
                      STAMP_LIBRARY_DRAG_TYPE,
                      entry.id,
                    );
                  }}
                >
                  <img
                    src={entry.image.dataUrl}
                    alt=""
                    draggable={false}
                    loading="lazy"
                    className="max-h-full max-w-full object-contain"
                  />
                </button>
                <button
                  type="button"
                  title={t("stamp.remove_image")}
                  aria-label={t("stamp.remove_named_image", {
                    name: entry.name,
                  })}
                  className="bg-background text-muted-foreground hover:text-destructive focus-visible:ring-ring absolute top-0 right-0 rounded p-1 opacity-70 shadow-sm group-hover:opacity-100 focus-visible:ring-2"
                  onClick={() =>
                    void remove(entry.id).catch(() =>
                      toast.error(t("stamp.library_save_error")),
                    )
                  }
                >
                  <Trash2 size={12} />
                </button>
                <div
                  className="text-muted-foreground mt-1 truncate text-center text-[10px]"
                  title={entry.name}
                >
                  {entry.name}
                </div>
              </div>
            ))}
          </div>
        )}
        {unsavedImage && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              void add(t("properties.image_stamp"), image).catch(() =>
                toast.error(t("stamp.library_save_error")),
              )
            }
          >
            {t("stamp.save_image")}
          </Button>
        )}
      </ImageUploadField>
    </div>
  );
};
