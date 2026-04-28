import { viteStaticCopy } from "vite-plugin-static-copy";

export const createStaticCopyPlugin = () =>
  viteStaticCopy({
    targets: [
      {
        src: "node_modules/pdfjs-dist/cmaps/*",
        dest: "pdfjs/cmaps",
      },
      {
        src: "node_modules/pdfjs-dist/standard_fonts/*",
        dest: "pdfjs/standard_fonts",
      },
      {
        src: "generated-icons/app/128x128@2x.png",
        dest: "pwa/app",
      },
      {
        src: "generated-icons/app/icon.png",
        dest: "pwa/app",
      },
      {
        src: "generated-icons/pdf/128x128.png",
        dest: "pwa/pdf",
      },
      {
        src: "generated-icons/pdf/128x128@2x.png",
        dest: "pwa/pdf",
      },
    ],
  });
