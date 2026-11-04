import {
  encodeButtonImage,
  MAX_BUTTON_IMAGE_BYTES,
} from "@legir/pdf-model/buttonImage";

/** Read and validate local image bytes, never fetch a URL supplied by a document. */
export function readButtonImageFile(file: File): Promise<string> {
  if (file.size > MAX_BUTTON_IMAGE_BYTES)
    return Promise.reject(new Error("Image exceeds 20 MiB"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Cannot read image"));
    reader.onabort = () => reject(new Error("Image read cancelled"));
    reader.onload = () => {
      try {
        if (!(reader.result instanceof ArrayBuffer))
          throw new Error("Cannot read image");
        resolve(encodeButtonImage(new Uint8Array(reader.result)));
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}
