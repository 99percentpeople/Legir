type PageSpaceRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const bytesToDataUrl = async (bytes: Uint8Array, mimeType: string) => {
  if (typeof FileReader === "undefined") {
    throw new Error("Data URL conversion is unavailable in this environment.");
  }

  const blob = new Blob([bytes.slice()], { type: mimeType || "image/png" });
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("Failed to encode rendered stamp image."));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Invalid rendered stamp image data."));
    };
    reader.readAsDataURL(blob);
  });
};

const loadCanvasImageSource = async (
  bytes: Uint8Array,
  mimeType: string,
): Promise<CanvasImageSource> => {
  const blob = new Blob([bytes.slice()], { type: mimeType || "image/png" });

  if (typeof createImageBitmap === "function") {
    return await createImageBitmap(blob);
  }

  if (typeof Image === "undefined" || typeof URL === "undefined") {
    throw new Error("Image decoding is unavailable in this environment.");
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new Error("Failed to decode rendered stamp appearance."));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const releaseCanvasImageSource = (source: CanvasImageSource) => {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    source.close();
  }
};

const getCanvasImageSourceDimensions = (source: CanvasImageSource) => {
  if (
    typeof source === "object" &&
    source !== null &&
    "naturalWidth" in source &&
    "naturalHeight" in source &&
    typeof source.naturalWidth === "number" &&
    typeof source.naturalHeight === "number"
  ) {
    return {
      width: source.naturalWidth,
      height: source.naturalHeight,
    };
  }

  if (
    typeof source === "object" &&
    source !== null &&
    "width" in source &&
    "height" in source &&
    typeof source.width === "number" &&
    typeof source.height === "number"
  ) {
    return {
      width: source.width,
      height: source.height,
    };
  }

  return null;
};

const createRasterSurface = (width: number, height: number) => {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }

  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return { canvas, context: canvas.getContext("2d") };
  }

  throw new Error("Canvas rendering is unavailable in this environment.");
};

const canvasToPngDataUrl = async (
  canvas: OffscreenCanvas | HTMLCanvasElement,
) => {
  const blob =
    typeof OffscreenCanvas === "function" && canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((resolve, reject) => {
          (canvas as HTMLCanvasElement).toBlob((value) => {
            if (value) {
              resolve(value);
              return;
            }
            reject(new Error("Failed to encode cropped stamp image."));
          }, "image/png");
        });

  return bytesToDataUrl(new Uint8Array(await blob.arrayBuffer()), "image/png");
};

const clampPageSpaceRectToBounds = (
  pageWidth: number,
  pageHeight: number,
  rect: PageSpaceRect,
) => {
  const left = Math.max(0, Math.min(pageWidth, rect.x));
  const top = Math.max(0, Math.min(pageHeight, rect.y));
  const right = Math.max(left, Math.min(pageWidth, rect.x + rect.width));
  const bottom = Math.max(top, Math.min(pageHeight, rect.y + rect.height));

  if (right - left <= 0 || bottom - top <= 0) return undefined;

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
};

export const cropRenderedPageImageToDataUrl = async (options: {
  bytes: Uint8Array;
  mimeType: string;
  pageWidth: number;
  pageHeight: number;
  cropRect: PageSpaceRect;
}) => {
  const clampedRect = clampPageSpaceRectToBounds(
    options.pageWidth,
    options.pageHeight,
    options.cropRect,
  );
  if (!clampedRect) return undefined;

  const imageSource = await loadCanvasImageSource(
    options.bytes,
    options.mimeType,
  );
  try {
    const decodedSize = getCanvasImageSourceDimensions(imageSource);
    const sourceImageWidth = Math.max(
      1,
      decodedSize?.width ?? options.pageWidth,
    );
    const sourceImageHeight = Math.max(
      1,
      decodedSize?.height ?? options.pageHeight,
    );
    const sourceX = Math.max(
      0,
      Math.min(
        sourceImageWidth - 1,
        Math.floor((clampedRect.x / options.pageWidth) * sourceImageWidth),
      ),
    );
    const sourceY = Math.max(
      0,
      Math.min(
        sourceImageHeight - 1,
        Math.floor((clampedRect.y / options.pageHeight) * sourceImageHeight),
      ),
    );
    const sourceRight = Math.max(
      sourceX + 1,
      Math.min(
        sourceImageWidth,
        Math.ceil(
          ((clampedRect.x + clampedRect.width) / options.pageWidth) *
            sourceImageWidth,
        ),
      ),
    );
    const sourceBottom = Math.max(
      sourceY + 1,
      Math.min(
        sourceImageHeight,
        Math.ceil(
          ((clampedRect.y + clampedRect.height) / options.pageHeight) *
            sourceImageHeight,
        ),
      ),
    );
    const croppedWidth = Math.max(1, sourceRight - sourceX);
    const croppedHeight = Math.max(1, sourceBottom - sourceY);
    const { canvas, context } = createRasterSurface(
      croppedWidth,
      croppedHeight,
    );
    if (!context) {
      throw new Error("Failed to initialize canvas for stamp crop.");
    }

    context.drawImage(
      imageSource,
      sourceX,
      sourceY,
      croppedWidth,
      croppedHeight,
      0,
      0,
      croppedWidth,
      croppedHeight,
    );

    return {
      dataUrl: await canvasToPngDataUrl(canvas),
      width: croppedWidth,
      height: croppedHeight,
    };
  } finally {
    releaseCanvasImageSource(imageSource);
  }
};
