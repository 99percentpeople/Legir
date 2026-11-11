# Marketing site

`www/package.json` owns the site's runtime and build dependencies. The root
`package.json` owns the PDF application. Both use the workspace `bun.lock`, so
common dependencies can be deduplicated without making the site depend on the
application's manifest.

## Install and build independently

Use Node 24 and Bun 1.4.2. From a clean repository checkout:

```sh
bun install --frozen-lockfile --filter '!./' --filter legir-www --linker hoisted --ignore-scripts --force
bun run build:www
```

The filters exclude the root application and install the site plus its declared
dependencies. Hoisting lets shared components under root `src/` resolve those
dependencies; it does not add the application's dependency graph. Lifecycle
scripts are skipped because the root Husky setup is only needed for development.
For normal development across both projects, use `bun install` at the root.

`--force` rebuilds dependency links even when package versions are unchanged.
This matters when Vercel restores an older isolated installation: otherwise an
unchanged GFM package can retain a link to `micromark-util-types@2.0.2` while the
updated parser uses the locked `2.0.3`, splitting GFM's type augmentations across
two modules. The frozen lockfile still controls the installed versions.

The site reuses UI, translations, styles, and static assets from the application.
Its only PDF package is `@legir/pdf-model`, built before typechecking. AI SDKs,
Tauri, PDFium, `pdf-core`, and `pdf-renderer` are not required. Keep shared display
types independent of those runtimes, including type-only imports.

Vite resolves shared components against the site's declared dependency versions.
When a shared component starts importing another package, declare it here if the
site needs that component. The independent `build-www` workflow runs the exact
Vercel install command against both a clean checkout and a restored isolated
Markdown installation, without installing the app's dependencies.

## Deployment

Deploy with Vercel Root Directory `www`, with source outside the root directory
included. `www/vercel.json` runs the filtered install from the repository root,
then builds in `www` and publishes `dist`. Use the checked-in install command;
a dashboard override that installs the entire workspace bypasses this boundary.

See the root [deployment guide](../README.md#deployment) for domains and app links.
