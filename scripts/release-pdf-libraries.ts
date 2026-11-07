import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const names = ["pdfium", "pdf-model", "pdf-core", "pdf-renderer"];
const repository = "https://github.com/99percentpeople/Legir";

type PackageMetadata = Record<string, unknown> & {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

export function releaseVersion(tag: string) {
  const match = /^pdf-libs-v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) throw new Error("Expected a pdf-libs-vX.Y.Z tag");
  return match[1];
}

export function releasePackageMetadata<T extends PackageMetadata>(
  metadata: T,
  tag: string,
  revision: string,
) {
  const version = releaseVersion(tag);
  if (
    metadata.version !== version ||
    !names.some((name) => metadata.name === `@legir/${name}`)
  )
    throw new Error("All four package versions must match the library tag");
  const result = structuredClone(metadata);
  for (const kind of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ] as const) {
    const dependencies = result[kind];
    if (!dependencies) continue;
    for (const [name, range] of Object.entries(dependencies)) {
      if (names.some((item) => name === `@legir/${item}`))
        dependencies[name] =
          `${repository}/releases/download/${tag}/legir-${name.slice(7)}-${version}.tgz`;
      else if (typeof range === "string" && range.startsWith("workspace:"))
        throw new Error(`Unpublished workspace dependency: ${name}`);
    }
  }
  return {
    ...result,
    repository: {
      type: "git",
      url: `${repository}.git`,
      directory: `packages/${metadata.name.slice(7)}`,
    },
    legirRelease: { revision, tag },
  };
}

async function prepare(sourceArg: string, tag: string, outputArg: string) {
  releaseVersion(tag);
  const source = path.resolve(sourceArg),
    output = path.resolve(outputArg);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: source, encoding: "utf8" }).trim();
  if (git("status", "--porcelain"))
    throw new Error("Release source must be clean");
  const revision = git("rev-parse", "HEAD");
  if (revision !== git("rev-parse", `refs/tags/${tag}^{commit}`))
    throw new Error("The checked out source must match the release tag");
  await mkdir(output, { recursive: true });
  const stage = await mkdtemp(path.join(os.tmpdir(), "legir-release-"));
  const packages: Array<{
    name: string;
    version: string;
    file: string;
    url: string;
    sha256: string;
  }> = [];
  try {
    for (const name of names) {
      const folder = path.join(source, "packages", name);
      const metadata = releasePackageMetadata(
        JSON.parse(await readFile(path.join(folder, "package.json"), "utf8")),
        tag,
        revision,
      );
      const target = path.join(stage, name);
      await cp(folder, target, {
        recursive: true,
        filter: (file) =>
          !path.relative(folder, file).split(path.sep).includes("node_modules"),
      });
      await writeFile(
        path.join(target, "package.json"),
        JSON.stringify(metadata, null, 2) + "\n",
      );
      const file = `legir-${name}-${metadata.version}.tgz`;
      execFileSync(
        "bun",
        [
          "pm",
          "pack",
          "--ignore-scripts",
          "--filename",
          path.join(output, file),
          "--quiet",
        ],
        { cwd: target, stdio: "pipe" },
      );
      const sha256 = createHash("sha256")
        .update(await readFile(path.join(output, file)))
        .digest("hex");
      packages.push({
        name: metadata.name,
        version: metadata.version,
        file,
        url: `${repository}/releases/download/${tag}/${file}`,
        sha256,
      });
    }
    await writeFile(
      path.join(output, "legir-libraries.json"),
      JSON.stringify(
        { format: 1, repository, revision, tag, packages },
        null,
        2,
      ) + "\n",
    );
    const checksums = packages.map((p) => `${p.sha256}  ${p.file}`);
    checksums.push(
      `${createHash("sha256")
        .update(await readFile(path.join(output, "legir-libraries.json")))
        .digest("hex")}  legir-libraries.json`,
    );
    await writeFile(
      path.join(output, "SHA256SUMS.txt"),
      checksums.join("\n") + "\n",
    );
    await writeFile(
      path.join(output, "release-notes.md"),
      `Reusable PDF libraries built from ${revision}.\n\nInstall a package directly; internal dependencies use this same release:\n\n\`\`\`sh\nbun add @legir/pdf-core@${packages.find((p) => p.name === "@legir/pdf-core")!.url}\n\`\`\`\n\nIncludes built JavaScript, TypeScript declarations, PDFium WASM and package licenses. SHA256SUMS.txt and legir-libraries.json pin every package. This is a library release, separate from desktop installers.\n`,
    );
    console.log(JSON.stringify({ tag, revision, packages: packages.length }));
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [source, tag, output] = process.argv.slice(2);
  if (!source || !tag || !output)
    throw new Error(
      "Usage: bun scripts/release-pdf-libraries.ts SOURCE TAG OUTPUT",
    );
  await prepare(source, tag, output);
}
