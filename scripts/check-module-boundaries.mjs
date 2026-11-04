import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const layers = {
  "pdf-model": [],
  pdfium: [],
  "pdf-core": ["pdf-model", "pdfium"],
  "pdf-renderer": ["pdf-model", "pdfium", "pdf-core"],
};
const errors = [];
let count = 0;
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
const packageName = (specifier) =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];

for (const [name, dependencies] of Object.entries(layers)) {
  const base = path.join(root, "packages", name);
  const source = path.join(base, "src");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(base, "package.json"), "utf8"),
  );
  const declared = new Set(
    Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }),
  );
  for (const file of walk(source).filter((file) => /\.tsx?$/.test(file))) {
    count++;
    const text = fs.readFileSync(file, "utf8");
    const relative = path.relative(root, file);
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (/import\.meta\.env|__PDFIUM_VERSION__/.test(text))
      errors.push(
        `${relative}: bundler/application configuration belongs in the host`,
      );
    const check = (specifier) => {
      if (specifier.startsWith(".")) {
        const target = path.resolve(path.dirname(file), specifier);
        if (!target.startsWith(base + path.sep))
          errors.push(
            `${relative}: relative import escapes the package: ${specifier}`,
          );
      } else {
        const dependency = packageName(specifier);
        if (
          specifier.startsWith("@/") ||
          path.isAbsolute(specifier) ||
          specifier.includes("/src/")
        ) {
          errors.push(
            `${relative}: private application/source import: ${specifier}`,
          );
        } else if (
          dependency.startsWith("@legir/") &&
          dependency !== manifest.name &&
          !dependencies.includes(dependency.slice(7))
        ) {
          errors.push(`${relative}: forbidden layer dependency: ${specifier}`);
        } else if (dependency !== manifest.name && !declared.has(dependency)) {
          errors.push(`${relative}: undeclared dependency: ${specifier}`);
        }
      }
    };
    const visit = (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        check(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        ts.isStringLiteral(node.arguments[0])
      )
        check(node.arguments[0].text);
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      )
        check(node.argument.literal.text);
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Module boundaries OK: ${count} source modules across ${Object.keys(layers).length} packages.`,
  );
}
