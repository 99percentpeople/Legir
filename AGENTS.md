# Repository Guidelines

## Project Structure & Module Organization

- `src/` houses the React + Vite app. Key areas: `src/pages/` (screens), `src/components/` (UI + workspace layers), `src/store/` (Zustand SSOT), `src/services/` (PDF pipeline, file ops, AI), `src/workers/`, `src/styles/`, `src/locales/`.
- `src-tauri/` contains the desktop wrapper and Rust entry points.
- `public/` stores static assets like pdfjs resources and bundled fonts.
- `docs/ARCHITECTURE.md` is the canonical map of data flow and extension points.
- If a directory contains `README.md`, read it before adding or moving code there.
- Keep shared code in the narrowest valid home: `src/lib/` for cross-feature helpers, `src/utils/` for pure utilities, `src/services/pdfService/lib/` for PDF-domain helpers, `src/components/workspace/lib/` for workspace-only helpers. Keep data contracts in the nearest `types.ts`.

## Build, Test, and Development Commands

- `bun install` installs dependencies (Bun is the expected package manager).
- `bun run dev` starts the web dev server.
- `bun run dev:app` runs the Tauri desktop app in dev mode.
- `bun run build` typechecks and builds the web app.
- `bun run build:app` builds the Tauri desktop package.
- `bun run lint` runs ESLint and TypeScript checks.
- `bun run format` formats with Prettier and Tailwind class sorting.
- `bun run preview` runs the production preview after a Turbo build.

## Coding Style & Naming Conventions

- TypeScript + React with ES modules; keep components in PascalCase and hooks/stores in `use*` form (example `useEditorStore`).
- Indentation, wrapping, and Tailwind class ordering are handled by Prettier; do not hand-align complex blocks.
- Prefer small, focused components in `src/components/`.

## Testing Guidelines

- No automated test runner is configured yet.
- If you add tests, use `*.test.ts(x)` or a nearby `__tests__/` folder and add a `test` script to `package.json`.

## Commit & Pull Request Guidelines

- Follow the existing commit style: `feat: ...`, `fix: ...`, `pref: ...` with short summaries.
- PRs should include a clear description, linked issues, and screenshots or GIFs for UI changes.
- Call out whether changes affect web, Tauri desktop, or both.

## Security & Configuration Tips

- Put secrets in `.env.local` (example `GEMINI_API_KEY=...`) and never commit them.
- Desktop permissions live in `src-tauri/capabilities/`; keep scopes minimal when adjusting access.
