import React from "react";
import { ImageUpIcon, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/utils/cn";

interface ImageUploadFieldProps {
  imageData?: string;
  alt: string;
  accept?: string;
  uploadLabel: string;
  replaceLabel?: string;
  emptyState?: React.ReactNode;
  preview?: React.ReactNode;
  onUpload: (file: File) => void | Promise<void>;
  onClear?: () => void;
  className?: string;
  previewFrameClassName?: string;
  imageClassName?: string;
  triggerClassName?: string;
}

export const ImageUploadField: React.FC<ImageUploadFieldProps> = ({
  imageData,
  alt,
  accept = "image/*",
  uploadLabel,
  replaceLabel,
  emptyState,
  preview,
  onUpload,
  onClear,
  className,
  previewFrameClassName,
  imageClassName,
  triggerClassName,
}) => {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dragDepthRef = React.useRef(0);
  const [isDragging, setIsDragging] = React.useState(false);

  const openPicker = React.useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFileUpload = React.useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      await onUpload(file);
    },
    [onUpload],
  );

  const handleChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      try {
        await handleFileUpload(event.target.files?.[0]);
      } finally {
        event.target.value = "";
      }
    },
    [handleFileUpload],
  );

  const handleDragEnter = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDragging(true);
    },
    [],
  );

  const handleDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [],
  );

  const handleDragLeave = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDragging(false);
      }
    },
    [],
  );

  const handleDrop = React.useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      await handleFileUpload(event.dataTransfer.files?.[0]);
    },
    [handleFileUpload],
  );

  return (
    <div
      className={cn(
        "border-input bg-muted/20 flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-2",
        className,
      )}
    >
      <div
        className={cn(
          "relative flex aspect-video w-full items-center justify-center overflow-hidden",
          isDragging && "border-primary/60 ring-primary/20 ring-2",
          previewFrameClassName,
        )}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {imageData ? (
          (preview ?? (
            <img
              src={imageData}
              alt={alt}
              className={cn(
                "max-h-full max-w-full object-contain",
                imageClassName,
              )}
            />
          ))
        ) : (
          <div className="flex flex-col items-center gap-3 px-4 text-center">
            {emptyState ?? <div className="text-muted-foreground text-xs" />}
            <Button
              type="button"
              variant="secondary"
              className={cn(triggerClassName)}
              onClick={openPicker}
            >
              <ImageUpIcon />
              {uploadLabel}
            </Button>
          </div>
        )}

        {imageData && onClear ? (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute top-1 right-1 h-6 w-6"
            onClick={onClear}
          >
            <Trash2 size={12} />
          </Button>
        ) : null}
      </div>

      <Input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleChange}
      />

      {imageData ? (
        <label className="cursor-pointer">
          <Button
            variant="outline"
            className={cn(triggerClassName)}
            onClick={openPicker}
          >
            <Upload />
            {replaceLabel ?? uploadLabel}
          </Button>
        </label>
      ) : null}
    </div>
  );
};
