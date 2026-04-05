# Legir

Legir is a local-first PDF workspace for reading, navigating, annotating, and editing PDF forms.

It is built for practical document work rather than generic file preview. You can open local PDFs, mark them up, fill or create form controls, and export the result back to PDF. Optional AI-assisted features can help with document understanding, but the core experience remains a fast client-side PDF editor.

## What You Can Do

- Read and navigate PDFs in a focused workspace
- Add annotations such as highlight, ink, comment, free text, and shapes
- Create and edit form controls such as text, checkbox, radio, dropdown, and signature
- Reopen recent files and restore the last editor UI state
- Run in the browser or as a Tauri desktop app
- Keep the main workflow local-first

## Available As

- Browser app for local PDF work
- Tauri desktop app for a native local workflow
- Separate `www` landing site for marketing / public entry

## Typical Use Cases

- Review a PDF and leave visual markup
- Fill or design interactive PDF forms
- Reopen in-progress document work quickly
- Use a desktop-style local workflow without sending files to a server

## Quick Start

```bash
bun install
bun run dev
```

Desktop: `bun run dev:app`  
Landing site: `bun run dev:www`

## Deployment

Deploy the repository root as the app project, and deploy `www/` as a separate Vercel project with `Root Directory = www`.

If the landing site needs to link to the app, set:

```bash
VITE_APP_URL=https://app.your-domain.com
```

## For Contributors

For the internal architecture and module layout, see:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
