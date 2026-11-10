import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sdk = path.dirname(fileURLToPath(import.meta.resolve("@legir/pdfium")));
const destination = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "public/pdfium",
);
mkdirSync(destination, { recursive: true });
// Includes wasm/licenses: do not redistribute only the binary and loader.
cpSync(path.resolve(sdk, "../wasm"), destination, { recursive: true });
