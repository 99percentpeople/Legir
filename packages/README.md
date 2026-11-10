# Reusable PDF modules

Legir is the application host, not a dependency of its PDF libraries.

## Install from npm

The four libraries are published independently from desktop releases:

```sh
bun add @legir/pdf-core
# or
npm install @legir/pdf-core
```

Internal library dependencies use the same npm release and the same version.
Packages include compiled JavaScript, declarations, licenses and the PDFium WASM
assets; consumers do not clone Legir, build its application or run dependency build
scripts. Keep `bun.lock` committed.

To publish, first give all four packages the same version and commit the change,
then push a matching `pdf-libs-vX.Y.Z` tag. The `publish-pdf-libraries` workflow
builds the exact tagged source, checks package boundaries and an isolated consumer,
packs the four tarballs, and publishes them to npm in dependency order. Publishing
uses npm Trusted Publishing (OIDC), with each package trusting
`99percentpeople/Legir` and workflow `pdf-libraries-release.yml`; no long-lived
npm secret is stored in GitHub. For an existing tag, dispatch the workflow from
that same tag so its OIDC provenance matches the release source. The single CI job builds, verifies checksums and tests the tarballs, then
publishes those same files directly; artifacts are retained only for diagnosis.
Before uploading any package, the script checks all four for checksum/version
conflicts and refuses to publish a missing version older than npm's `latest`.
Identical already-published tarballs are skipped, so a failed run can be retried;
different bytes at the same version require a new version. All library releases
share one concurrency group to prevent competing updates to `latest`.

The workflow retains `legir-libraries.json` and `SHA256SUMS.txt` as build artifacts.
It creates no GitHub Release assets and does not affect desktop installer releases.
To check local tarballs against npm without publishing, run:

```sh
node scripts/publish-npm-libraries.mjs /path/to/release-assets --check
```

| Package               | Owns                                                                                                       | Does not own                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `@legir/pdf-model`    | Document/field/annotation contracts, coordinates, geometry, stamp data and editing policies                | React, AI settings, Tauri, persistence, WASM                              |
| `@legir/pdfium`       | Native PDFium/WASM objects, rendering, authoring and resource lifetime                                     | Application models, UI and worker scheduling                              |
| `@legir/pdf-core`     | Import/export, AcroForm appearances, annotations, fonts, page assembly and transactional document sessions | Application stores, event bus, filesystem/UI dialogs, bundler asset paths |
| `@legir/pdf-renderer` | Worker client, byte-owner registry, browser render queue, thumbnail/render caches and worker entry points  | Vite worker constructors, Tauri calls, application singletons             |

Dependency direction:

```text
Legir UI / stores / platform adapters
  ├─ pdf-renderer ── pdf-core ── pdfium
  │       └──────────┴───────── pdf-model
  └─ application preferences, file storage, AI and desktop services
```

`src/services/pdfService/host.ts` connects Legir's event bus, font providers,
content-worker constructor and document-owner lookup to the core. `assets.ts`
provides the Vite/PWA asset locations in the main realm and render worker.
`pdfWorkerService.ts` supplies the render-worker constructor and preserves the
application's lazy default client. The packages never import those adapters.

## Development and verification

```sh
bun install
bun run build:packages
bun run check:boundaries
bun run test
bun run test:pdfium
bun run test:consumer
bun run lint
bun run build
bun run build:www
```

Library functional tests live in each package's `tests/` directory. The root
`bun run test` runs the application project plus all four library projects.
After building packages, run one independently with
`bun run --cwd packages/pdf-core test` (substitute any library name), or select
it from the root with `bun x vitest run --project pdf-core`. Application-host
integration tests remain under the root `tests/`; release/packing/consumer
checks also stay there because they protect the repository's publishing toolchain.
Test fixture versions are synthetic and never need changing when bumping packages.

`bun run dev` initially builds declarations, then Vite resolves the three new
workspace packages to their source files for HMR. Production builds and tests
use the compiled package exports. Each new package build removes its own `dist`
before emitting, so moved/deleted source modules cannot survive in a tarball.

`check:boundaries` checks all four source trees for reversed layer dependencies,
undeclared imports, application aliases and bundler configuration. It runs in
both lint and the main test command.

`test:consumer` builds and packs the four packages, installs them in a temporary
directory outside this repository, and runs a plain Node consumer. It checks
AcroForm import/fill/export/flatten, identical editable/flattened page pixels,
transaction rollback, explicit cleanup, private-path rejection and lazy renderer
import. It also typechecks/builds the standalone browser example. It does not
publish packages or run dependency install scripts. Failed temporary consumers
are retained for diagnosis; successful ones are removed.

## API and scope

Only paths listed in each package's `exports` map are public. There are no
wildcard code exports; adding an implementation file does not publish a new API.
The application, renderer and development HMR aliases use this same allowlist.
Tests of implementation details may import repository-local compiled files; that
does not make those paths part of the npm API.

| Core entry                                                  | Intended use                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `@legir/pdf-core`                                           | `DocumentSession`, export API and document contracts                   |
| `@legir/pdf-core/host`                                      | Fixed, realm-scoped asset/font/event capabilities                      |
| `@legir/pdf-core/content`                                   | Byte-oriented content jobs and owner-password checks                   |
| `@legir/pdf-core/pipeline`                                  | Advanced host-managed loading (`loadPdf`) and progress helpers         |
| `@legir/pdf-core/runtime`                                   | Advanced engine/worker adapter integration, not ordinary document jobs |
| `@legir/pdf-core/text`                                      | Text extraction contracts and layout math                              |
| `@legir/pdf-core/search`                                    | Text search helpers                                                    |
| `@legir/pdf-core/previews`                                  | Saved-output preview association                                       |
| `@legir/pdf-core/types`                                     | Parser/exporter and viewport contracts                                 |
| `@legir/pdf-core/lib/{coords,freeTextLayout,pageStructure}` | Explicitly supported geometry/page helpers                             |

`pdf-model` exposes its root contracts and explicitly listed pure helper subpaths.
Browser file reading and drag/drop belong to application adapters, not the model.
`pdf-renderer` exposes its client root, `worker`, `content-worker`, and typed
`protocol`; caches and the mutable owner registry are private. `pdfium` keeps its
root, `authoring` and `wasm/*` asset exports.

Use one `DocumentSession` per document job and serialize operations on that session;
always dispose it. Worker clients own their worker lifecycle and must be destroyed.
`configurePdfHost` and the permission policy provider remain realm-scoped: configure
fixed capabilities once, not tenant-specific values on concurrent requests. Asset
URLs must be configured in each worker realm as well as the main thread when used.

See [the standalone browser example](../examples/pdf-browser/README.md). Consumer
verification typechecks and builds that example using only installed tarballs;
`LEGIR_BROWSER_BIN=chromium bun run test:consumer` also runs a real Worker/WASM
raster smoke test. This is not a full cross-browser or Tauri compatibility claim.

The React workspace, form property panels, toolbars, history stores, AI features
and Web/Tauri persistence stay in the application. This refactor does not claim
to ship a ready-made standalone React form designer or a template HTTP service.
Those can now share the same model, core and worker implementation rather than
copying the application or adding another PDF engine.

## License boundary

All four libraries offer their Legir-authored code under **MIT**, allowing
closed-source commercial use, modification and redistribution with the copyright
and license notice retained. Each published package includes its own `LICENSE`.
The Legir application outside these libraries remains AGPL-3.0-or-later; using
the libraries does not grant an MIT license to the application's UI or services.

PDFium, Emscripten and other dependencies retain their original licenses and
notices. `@legir/pdfium/wasm/licenses/` must accompany redistribution of the
compiled engine. The SDK's native files keep their historical BSD-3-Clause
headers for build provenance; its `LICENSE` explicitly offers MIT as an additional
option for that Legir-authored code and retains the earlier BSD grant.

This change applies to source and releases containing these MIT notices. It does
not rewrite previously published artifacts or old Git tags. Publish a new version
and tag containing this change to distribute the MIT-licensed libraries.
