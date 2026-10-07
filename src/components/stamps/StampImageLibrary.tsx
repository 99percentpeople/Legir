import React from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { useStampLibraryStore } from "@/store/stampLibraryStore";
import {
  createStampImageResource,
  isStampImageFile,
  loadStampImageFile,
  STAMP_IMAGE_ACCEPT,
  STAMP_LIBRARY_DRAG_TYPE,
} from "@/lib/stampImage";
import type { StampImageResource } from "@/types";
import { cn } from "@/utils/cn";

interface StampImageLibraryProps {
  image?: StampImageResource;
  onSelect: (image: StampImageResource) => void;
}

export const StampImageLibrary = ({
  image,
  onSelect,
}: StampImageLibraryProps) => {
  const { t } = useLanguage();
  const { entries, refresh, add, remove } = useStampLibraryStore();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);

  React.useEffect(() => {
    void refresh().catch(() => toast.error(t("stamp.library_load_error")));
  }, [refresh, t]);

  const importFiles = async (files: File[]) => {
    if (busy) return;
    setBusy(true);
    try {
      let selected: StampImageResource | undefined;
      for (const file of files) {
        if (!isStampImageFile(file)) continue;
        try {
          const asset = await loadStampImageFile(file);
          const resource = createStampImageResource(asset)!;
          await add(file.name, resource, file);
          selected ??= resource;
        } catch {
          toast.error(t("stamp.import_error", { name: file.name }));
        }
      }
      if (selected) onSelect(selected);
    } finally {
      setBusy(false);
    }
  };

  const unsavedImage =
    image?.dataUrl &&
    !entries.some((entry) => entry.image.dataUrl === image.dataUrl);

  return (
    <div
      className={cn("space-y-2 rounded-md", dragging && "ring-primary ring-2")}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        void importFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="text-sm font-medium">{t("stamp.custom_images")}</div>
      <p className="text-muted-foreground text-xs">{t("stamp.library_hint")}</p>
      <div className="grid max-h-60 grid-cols-3 gap-2 overflow-y-auto p-1">
        <button
          type="button"
          disabled={busy}
          className="border-input text-muted-foreground hover:bg-accent focus-visible:ring-ring flex h-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed p-2 text-xs focus-visible:ring-2 disabled:opacity-50"
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus size={20} />
          {t("stamp.add_images")}
        </button>
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
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(STAMP_LIBRARY_DRAG_TYPE, entry.id);
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
              aria-label={t("stamp.remove_named_image", { name: entry.name })}
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
      {unsavedImage && (
        <div className="flex items-center gap-2 rounded border p-2">
          <img
            src={image.dataUrl}
            alt={t("properties.image_stamp")}
            className="h-10 w-12 object-contain"
          />
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
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={STAMP_IMAGE_ACCEPT}
        aria-label={t("stamp.add_images")}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void importFiles(files);
        }}
      />
    </div>
  );
};
