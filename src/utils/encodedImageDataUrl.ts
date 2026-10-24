/** Inline small encoded images without synchronous Blob URL registration. */
export function encodedImageDataUrl(bytes: Uint8Array, mimeType: string) {
  let binary = "";
  // Bound spread arguments and preserve the exact view's byte range.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}
