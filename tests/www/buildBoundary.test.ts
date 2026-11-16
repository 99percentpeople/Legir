// @vitest-environment node
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";
import { isWebsiteInput } from "../../scripts/check-www-changes.mjs";

it("keeps the landing site's type dependencies independent of app runtimes", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const configPath = path.join(root, "www/tsconfig.json");
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    path.dirname(configPath),
    {},
    configPath,
  );
  expect(parsed.errors).toEqual([]);

  // Include type-only imports: bundler tree-shaking cannot protect typechecking
  // from an accidental editor-controller or PDF SDK dependency.
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const sharedFiles = program
    .getSourceFiles()
    .map((file) => path.relative(root, file.fileName).replaceAll("\\", "/"))
    .filter((file) => file.startsWith("src/"));
  // A new shared import must also invalidate Vercel's ignored-build decision.
  expect(sharedFiles.filter((file) => !isWebsiteInput(file))).toEqual([]);
  const runtimeFiles = program
    .getSourceFiles()
    .map((file) => path.relative(root, file.fileName).replaceAll("\\", "/"))
    .filter(
      (file) =>
        file.startsWith("packages/pdfium/") ||
        file.startsWith("packages/pdf-core/") ||
        file.startsWith("packages/pdf-renderer/") ||
        /(?:^|\/)node_modules\/(?:ai\/|@ai-sdk\/|@tauri-apps\/)/.test(file) ||
        file.startsWith("src/services/pdfService/") ||
        file.startsWith("src/hooks/useAiChatController/") ||
        file === "src/app/editorTabs/runtimeContext.ts",
    );
  expect(runtimeFiles).toEqual([]);
}, 15_000);
