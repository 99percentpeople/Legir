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
const manifests = new Map(
  Object.keys(layers).map((name) => {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(root, "packages", name, "package.json"),
        "utf8",
      ),
    );
    return [manifest.name, manifest];
  }),
);
const errors = [];
const checkPublicExport = (specifier, file) => {
  const manifest = manifests.get(packageName(specifier));
  if (!manifest) return;
  const subpath =
    specifier === manifest.name
      ? "."
      : `.${specifier.slice(manifest.name.length)}`;
  const exposed = Object.keys(manifest.exports).some((key) => {
    if (!key.includes("*")) return key === subpath;
    const [prefix, suffix] = key.split("*");
    return subpath.startsWith(prefix) && subpath.endsWith(suffix);
  });
  if (!exposed) errors.push(`${file}: non-public package import: ${specifier}`);
};
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
        checkPublicExport(specifier, relative);
      }
    };
    const visit = (node) => {
      if (
        name === "pdf-model" &&
        ts.isIdentifier(node) &&
        [
          "window",
          "document",
          "FileReader",
          "Image",
          "DataTransfer",
          "Worker",
          "OffscreenCanvas",
        ].includes(node.text)
      ) {
        errors.push(
          `${relative}: browser adapter capability belongs outside pdf-model: ${node.text}`,
        );
      }
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
// Library functional tests may use package internals, but must not depend on
// application modules or aliases. Cross-package public imports still use exports.
for (const name of Object.keys(layers)) {
  const tests = path.join(root, "packages", name, "tests");
  if (!fs.existsSync(tests)) continue;
  for (const file of walk(tests).filter((file) => /\.tsx?$/.test(file))) {
    const relative = path.relative(root, file);
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const check = (specifier) => {
      const target = path.resolve(path.dirname(file), specifier);
      if (
        specifier.startsWith("@/") ||
        (specifier.startsWith(".") &&
          target.startsWith(path.join(root, "src") + path.sep))
      )
        errors.push(
          `${relative}: library test imports application code: ${specifier}`,
        );
      checkPublicExport(specifier, relative);
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
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}
// The application must consume the same public paths as external projects.
for (const file of walk(path.join(root, "src")).filter((file) =>
  /\.tsx?$/.test(file),
)) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      checkPublicExport(node.moduleSpecifier.text, path.relative(root, file));
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    )
      checkPublicExport(node.arguments[0].text, path.relative(root, file));
    ts.forEachChild(node, visit);
  };
  visit(source);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Module boundaries OK: ${count} source modules across ${Object.keys(layers).length} packages.`,
  );
}
