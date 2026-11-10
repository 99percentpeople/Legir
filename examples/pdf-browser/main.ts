import { PDFWorkerService } from "@legir/pdf-renderer";

const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const canvas = document.querySelector<HTMLCanvasElement>("#page")!;
const client = new PDFWorkerService({
  lazy: true,
  createWorker: () =>
    new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" }),
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  fileInput.disabled = true;
  status.dataset.state = "loading";
  status.textContent = "Loading and rendering…";
  try {
    await client.loadDocument(new Uint8Array(await file.arrayBuffer()));
    const rendered = await client.renderPageImage({
      pageIndex: 0,
      scale: 1,
      mimeType: "image/png",
    });
    if (!rendered) throw new Error("Page rendering failed");
    const image = await createImageBitmap(
      new Blob([new Uint8Array(rendered.bytes).buffer], {
        type: rendered.mimeType,
      }),
    );
    try {
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext("2d")!.drawImage(image, 0, 0);
    } finally {
      image.close();
    }
    status.textContent = `Rendered ${canvas.width} × ${canvas.height}`;
    status.dataset.state = "ready";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.dataset.state = "error";
  } finally {
    fileInput.disabled = false;
  }
});
fileInput.disabled = false;
window.addEventListener("pagehide", () => client.destroy(), { once: true });
