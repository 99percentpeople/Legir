import React from "react";
import { ImageUpIcon, LoaderCircle, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/utils/cn";

export interface ImageUploadContext {
  /** Ignore results after the upload target changes or the component unmounts. */
  signal: AbortSignal;
}

interface ImageUploadFieldBaseProps {
  imageData?: string;
  alt: string;
  accept?: string;
  uploadLabel: string;
  replaceLabel?: string;
  clearLabel?: string;
  emptyState?: React.ReactNode;
  preview?: React.ReactNode;
  /** Optional image library; file drops anywhere in this area use the same uploader. */
  children?: React.ReactNode;
  onClear?: () => void;
  onUploadError?: (error: unknown) => void;
  disabled?: boolean;
  selectionKey?: string;
  className?: string;
  previewFrameClassName?: string;
  imageClassName?: string;
  triggerClassName?: string;
}

export type ImageUploadFieldProps = ImageUploadFieldBaseProps &
  (
    | {
        multiple?: false;
        onUpload: (
          file: File,
          context: ImageUploadContext,
        ) => void | Promise<void>;
      }
    | {
        multiple: true;
        onUpload: (
          files: File[],
          context: ImageUploadContext,
        ) => void | Promise<void>;
      }
  );

/** Shared upload UI. File decoding, validation and persistence belong to the caller. */
export const ImageUploadField: React.FC<ImageUploadFieldProps> = (props) => {
  const {
    imageData,
    alt,
    accept = "image/*",
    uploadLabel,
    replaceLabel,
    clearLabel,
    emptyState,
    preview,
    children,
    onClear,
    onUploadError,
    disabled = false,
    selectionKey,
    className,
    previewFrameClassName,
    imageClassName,
    triggerClassName,
  } = props;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const pending = React.useRef<AbortController | null>(null);
  const dragDepth = React.useRef(0);
  const [busy, setBusy] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setBusy(false);
    setIsDragging(false);
    setError(null);
    return () => {
      pending.current?.abort();
      pending.current = null;
      dragDepth.current = 0;
    };
  }, [selectionKey, disabled]);

  // :disabled includes an enclosing permission fieldset, not just our own prop.
  const isDisabled = () => disabled || !!inputRef.current?.matches(":disabled");
  const openPicker = () => {
    if (!pending.current && !isDisabled()) inputRef.current?.click();
  };
  const upload = async (files: File[]) => {
    if (!files.length || pending.current || isDisabled()) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    try {
      const context = { signal: controller.signal };
      if (props.multiple) await props.onUpload(files, context);
      else await props.onUpload(files[0], context);
    } catch (cause) {
      if (pending.current !== controller || controller.signal.aborted) return;
      if (onUploadError) onUploadError(cause);
      else setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  const isFileDrag = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types).includes("Files");

  return (
    <fieldset
      data-slot="image-upload-field"
      disabled={disabled || busy}
      aria-busy={busy}
      className={cn("m-0 min-w-0 space-y-2 border-0 p-0", className)}
      onDragEnter={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if (isDisabled()) return;
        dragDepth.current += 1;
        setIsDragging(true);
      }}
      onDragOver={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = isDisabled() ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setIsDragging(false);
      }}
      onDrop={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setIsDragging(false);
        void upload(Array.from(event.dataTransfer.files));
      }}
    >
      <div
        className={cn(
          "border-input bg-muted/20 flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-2",
          isDragging && "border-primary/60 ring-primary/20 ring-2",
        )}
      >
        <div
          className={cn(
            "relative flex aspect-video w-full items-center justify-center overflow-hidden",
            previewFrameClassName,
          )}
        >
          {imageData ? (
            (preview ?? (
              <img
                src={imageData}
                alt={alt}
                draggable={false}
                className={cn("h-full w-full object-contain", imageClassName)}
              />
            ))
          ) : (
            <div className="flex flex-col items-center gap-3 px-4 text-center">
              {emptyState}
              <Button
                type="button"
                variant="secondary"
                className={triggerClassName}
                onClick={openPicker}
              >
                {busy ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <ImageUpIcon />
                )}
                {uploadLabel}
              </Button>
            </div>
          )}
          {imageData && onClear && (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              aria-label={clearLabel ?? alt}
              title={clearLabel}
              className="absolute top-1 right-1 h-6 w-6"
              onClick={() => {
                if (!isDisabled()) onClear();
              }}
            >
              <Trash2 size={12} />
            </Button>
          )}
        </div>
        <Input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={props.multiple}
          aria-label={uploadLabel}
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            // Clear immediately, including on rejection, so the same file can be retried.
            event.currentTarget.value = "";
            void upload(files);
          }}
        />
        {imageData && (
          <Button
            type="button"
            variant="outline"
            className={triggerClassName}
            onClick={openPicker}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <Upload />}
            {replaceLabel ?? uploadLabel}
          </Button>
        )}
        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
      </div>
      {children}
    </fieldset>
  );
};
