/** Browser file/drag adapters. Portable stamp resources live in pdf-model. */
export interface StampImageAsset {
  dataUrl: string;
  width: number;
  height: number;
  name: string;
}

export const STAMP_IMAGE_ACCEPT =
  "image/png,image/jpeg,image/webp,image/svg+xml";
export const STAMP_LIBRARY_DRAG_TYPE = "application/x-legir-stamp-image";

export const isStampImageFile = (file: { type: string; name: string }) =>
  /^(image\/(png|jpeg|jpg|webp|svg\+xml))$/i.test(file.type) ||
  /\.(png|jpe?g|webp|svg)$/i.test(file.name);

export const hasStampImageTransfer = (transfer: DataTransfer | null) =>
  !!transfer &&
  (Array.from(transfer.types).includes(STAMP_LIBRARY_DRAG_TYPE) ||
    Array.from(transfer.items).some(
      (item) =>
        item.kind === "file" && isStampImageFile({ type: item.type, name: "" }),
    ) ||
    Array.from(transfer.files).some(isStampImageFile));

export const loadStampImageFile = (file: File): Promise<StampImageAsset> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read stamp image."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Invalid stamp image data."));
        return;
      }
      const image = new Image();
      image.onerror = () => reject(new Error("Failed to decode stamp image."));
      image.onload = () =>
        resolve({
          dataUrl: result,
          width: image.naturalWidth,
          height: image.naturalHeight,
          name: file.name,
        });
      image.src = result;
    };
    reader.readAsDataURL(file);
  });
