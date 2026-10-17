// @vitest-environment node
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

it("keeps the landing site's type dependencies independent of the PDF runtime", () => {
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
  const runtimeFiles = program
    .getSourceFiles()
    .map((file) => path.relative(root, file.fileName).replaceAll("\\", "/"))
    .filter(
      (file) =>
        file.startsWith("packages/pdfium/") ||
        file.startsWith("src/services/pdfService/") ||
        file.startsWith("src/hooks/useAiChatController/") ||
        file === "src/app/editorTabs/runtimeContext.ts",
    );
  expect(runtimeFiles).toEqual([]);
}, 15_000);
