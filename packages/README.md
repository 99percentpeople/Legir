# Reusable PDF modules

Legir is the application host, not a dependency of its PDF libraries.

## Install from GitHub Releases

The four libraries are distributed independently from desktop releases. Pin a
library release URL, for example:

```sh
bun add @legir/pdf-core@https://github.com/99percentpeople/Legir/releases/download/pdf-libs-v0.3.0/legir-pdf-core-0.3.0.tgz
```

Internal library dependencies point to the same release automatically. Packages
include compiled JavaScript, declarations, licenses and the PDFium WASM assets;
consumers do not clone Legir, build its application or run dependency build scripts.
Keep `bun.lock` committed. `legir-libraries.json` records the source commit and
SHA-256 of all four assets, also listed in `SHA256SUMS.txt`.

To publish, first give all four packages the same version and commit the change,
then push a matching `pdf-libs-vX.Y.Z` tag. The `publish-pdf-libraries` workflow
builds the exact tagged source, checks package boundaries and an isolated consumer,
and publishes only after every asset is uploaded. For an existing tag that predates
the workflow, use its manual dispatch with that tag. Published assets are never
overwritten; fixes require a new version. These releases do not replace the latest
desktop installer release.

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
transaction rollback, explicit cleanup and lazy renderer import. It does not
publish packages or run dependency install scripts. Failed temporary consumers
are retained for diagnosis; successful ones are removed.

## API and scope

Use package roots for the documented entry points. Subpath exports preserve
fine-grained imports for Legir and its existing regression tests. Their file
structure remains a versioned API: do not rename them without updating callers.

The React workspace, form property panels, toolbars, history stores, AI features
and Web/Tauri persistence stay in the application. This refactor does not claim
to ship a ready-made standalone React form designer or a template HTTP service.
Those can now share the same model, core and worker implementation rather than
copying the application or adding another PDF engine.

## License boundary

The existing `@legir/pdfium` package remains BSD-3-Clause with its bundled
third-party notices. Code extracted from Legir retains AGPL-3.0-or-later in the
three new packages; this refactor does not relicense application-derived code.
