import { configurePdfHost } from "@legir/pdf-core/host";

configurePdfHost({
  moduleUrl: () =>
    new URL(`${import.meta.env.BASE_URL}pdfium/pdfium.js`, self.location.origin)
      .href,
});
