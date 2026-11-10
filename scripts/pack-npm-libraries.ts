import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Dependency order: every tarball only refers to packages published before it.
const names = ["pdf-model", "pdfium", "pdf-core", "pdf-renderer"] as const;
const repository = "https://github.com/99percentpeople/Legir";
const registry = "https://registry.npmjs.org";

type PackageMetadata = Record<string, unknown> & {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  publishConfig?: Record<string, unknown>;
};

export function releaseVersion(tag: string) {
  const match = /^pdf-libs-v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) throw new Error("Expected a pdf-libs-vX.Y.Z tag");
  return match[1];
}

export function npmPackageMetadata<T extends PackageMetadata>(
  metadata: T,
  tag: string,
  revision: string,
) {
  const version = releaseVersion(tag);
  if (metadata.version !== version)
    throw new Error("All four package versions must match the library tag");
  if (metadata.private) throw new Error("Cannot publish a private package");
  const shortName = names.find((name) => metadata.name === `@legir/${name}`);
  if (!shortName) throw new Error(`Unexpected package name: ${metadata.name}`);
  const result = structuredClone(metadata);
  for (const kind of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ] as const) {
    const dependencies = result[kind];
    if (!dependencies) continue;
    for (const [name, range] of Object.entries(dependencies)) {
      if (name.startsWith("@legir/")) {
        if (!names.some((item) => name === `@legir/${item}`))
          throw new Error(`Unknown workspace package: ${name}`);
        dependencies[name] = version;
      } else if (typeof range === "string" && range.startsWith("workspace:"))
        throw new Error(`Unpublished workspace dependency: ${name}`);
    }
  }
  return {
    ...result,
    publishConfig: { ...(result.publishConfig ?? {}), access: "public" },
    repository: {
      type: "git",
      url: `${repository}.git`,
      directory: `packages/${shortName}`,
    },
    legirRelease: { revision, tag },
  };
}

export async function packNpmLibraries(
  sourceArg: string,
  tag: string,
  outputArg: string,
) {
  const version = releaseVersion(tag);
  const source = path.resolve(sourceArg);
  const output = path.resolve(outputArg);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: source, encoding: "utf8" }).trim();
  if (git("status", "--porcelain"))
    throw new Error("Release source must be clean");
  const revision = git("rev-parse", "HEAD");
  if (revision !== git("rev-parse", `refs/tags/${tag}^{commit}`))
    throw new Error("The checked out source must match the release tag");
  await mkdir(output, { recursive: true });
  const stage = await mkdtemp(path.join(os.tmpdir(), "legir-npm-"));
  const packages: Array<{
    name: string;
    version: string;
    file: string;
    sha256: string;
  }> = [];
  try {
    for (const name of names) {
      const folder = path.join(source, "packages", name);
      const metadata = npmPackageMetadata(
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
      const file = `legir-${name}-${version}.tgz`;
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
        sha256,
      });
      console.log(`Packed ${metadata.name}@${metadata.version}`);
    }
    const manifest =
      JSON.stringify(
        {
          format: 2,
          registry,
          repository,
          revision,
          tag,
          packages,
        },
        null,
        2,
      ) + "\n";
    await writeFile(path.join(output, "legir-libraries.json"), manifest);
    const checksums = packages.map((item) => `${item.sha256}  ${item.file}`);
    checksums.push(
      `${createHash("sha256").update(manifest).digest("hex")}  legir-libraries.json`,
    );
    await writeFile(
      path.join(output, "SHA256SUMS.txt"),
      checksums.join("\n") + "\n",
    );
    console.log(
      JSON.stringify({
        tag,
        revision,
        registry,
        packages: packages.map((item) => item.name),
      }),
    );
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [source, tag, output] = process.argv.slice(2);
  if (!source || !tag || !output)
    throw new Error(
      "Usage: bun scripts/pack-npm-libraries.ts SOURCE TAG OUTPUT",
    );
  await packNpmLibraries(source, tag, output);
}
