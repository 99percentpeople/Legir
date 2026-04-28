# Legir Architecture

This document describes the internal architecture of Legir's main application.

It intentionally avoids repeating setup, build, and deployment instructions that already live in the root [README.md](../README.md). The focus here is module boundaries, data flow, persistence strategy, and extension points.

## Scope

This repository currently has two frontend surfaces:

- `src/`: the main PDF reader and editor
- `www/`: a separate marketing site

This document focuses on the main app in `src/`. The `www` site is intentionally much simpler and only reuses a small set of presentational components.

## High-Level Runtime Model

At runtime, the main app is composed of five major layers:

1. App shell and routing
2. Editor tab and window orchestration
3. PDF loading, rendering, and export services
4. Editor state and workspace UI
5. Platform-specific persistence and file handling

The main entry path is:

- `src/index.tsx`
- `src/App.tsx`
- `src/AppRoutes.tsx`

## Top-Level Module Map

```text
src/
  index.tsx
  App.tsx
  AppRoutes.tsx

  app/
    editorTabs/             Tab snapshots, session transfer, window layout
    useAppInitialization.ts App bootstrap
    useBootstrapAwareHashLocation.ts

  pages/
    HomePage/               App home page and recent file entry point
    EditorPage/             Editor shell and route-level orchestration

  components/
    workspace/              PDF pages, overlays, controls, interaction layers
    toolbar/                Editing commands and document actions
    sidebar/                Page list, outline, field/annotation navigation
    properties-panel/       Properties and optional AI-related panels
    home/                   Shared home/branding presentation components
    ui/                     Shared UI primitives

  services/
    pdfService/             PDF parsing, rendering, export, worker protocol
    recentFiles/            Recent-file storage adapters and browser handle logic
    platform/               Web/Tauri abstraction layer
    ai/                     Optional AI-related service entry points
    recentFilesService.ts   Desktop recent-files singleton service
    recentFilePreview.ts    Shared preview generation utility
    browserDb.ts            Shared IndexedDB setup for browser persistence

  store/
    useEditorStore.ts       Editor single source of truth
    helpers.ts
    selectors.ts

  locales/                  Translation dictionaries

src-tauri/
  Tauri host application
```

## App Shell

### `src/index.tsx`

The root entry mounts the React tree and wires the global providers:

- language provider
- theme provider
- toaster
- `wouter` router

The app currently uses a hash-based router through `useBootstrapAwareHashLocation`, which allows the desktop bootstrap flow to redirect to a special editor route without depending on server-side rewrite support.

### `src/App.tsx`

`App.tsx` is the orchestration layer. It is responsible for:

- opening documents from all supported sources
- deduplicating open documents by source key
- creating and restoring editor tab sessions
- wiring recent-files adapters
- applying persisted global editor UI state
- coordinating save, export, print, tab close, and multi-window flows

This file is intentionally operational rather than purely presentational.

### `src/AppRoutes.tsx`

Routing is simple:

- `/` renders `HomePage`
- `/editor` renders `EditorPage`

The editor route is guarded. If there is no active document/tab session, navigation falls back to the home page.

## Home Page and Recent Files

The app home page is implemented in:

- `src/pages/HomePage/index.tsx`
- `src/pages/HomePage/RecentFilesHomeView.tsx`
- `src/pages/HomePage/hooks/useHomeRecentFiles.ts`

This page does not own persistence itself. It consumes a `HomePageAdapter`, which keeps the UI layer independent from the actual recent-file backend.

The recent-file abstractions live in:

- `src/services/recentFiles/types.ts`
- `src/services/recentFiles/index.ts`

There are two concrete storage strategies:

- Browser: IndexedDB + `FileSystemFileHandle`
  - `src/services/recentFiles/indexedDbStore.ts`
  - `src/services/recentFiles/webFiles.ts`
- Desktop: localStorage-backed recent files with preview management
  - `src/services/recentFiles/platformStore.ts`
  - `src/services/recentFilesService.ts`

### Current Persistence Model

Recent files and editor UI state are intentionally separate:

- Recent files store lightweight metadata and previews
- Editor UI state is stored globally, not per file

That global UI session is implemented in:

- `src/services/platform/documentSession.ts`

This means reopening a document restores the last editor layout and reading position as a global editor preference rather than a per-document session.

## Document Open Flow

The current open flow is:

1. A file enters from one of several sources:
   - file picker
   - recent files
   - drag and drop
   - desktop startup/open-file events
2. `src/services/platform/files.ts` and `src/services/platform/app.ts` normalize the source
3. `src/App.tsx` loads the PDF through `loadPDF(...)`
4. A fresh `EditorTabSnapshot` is created
5. The persisted global UI session is applied
6. The tab is inserted into the current editor window
7. The route switches to `/editor`

The file-open abstractions deliberately hide the platform differences:

- Web uses browser file handles where available
- Desktop uses Tauri dialog and filesystem APIs

## Editor Tab and Window Model

Legir treats each open document as a tab session rather than a single monolithic editor instance.

The core types live in:

- `src/app/editorTabs/types.ts`

Important concepts:

- `EditorTabSnapshot`
  - a serializable view of editor state for one document
- `EditorTabSession`
  - snapshot + worker/service/resource ownership
- `EditorWindowLayout`
  - tab ordering and active-tab selection for a window

### Snapshot Creation and Restore

Tab snapshot logic lives in:

- `src/app/editorTabs/storeSnapshot.ts`

This module handles:

- creating a snapshot from the live editor store
- creating the initial snapshot after loading a PDF
- deriving stable source keys for deduplication
- restoring a snapshot back into the Zustand store

### Multi-Window Support

Tab and window transfer support lives in:

- `src/app/editorTabs/transfer.ts`
- `src/app/editorTabs/transferStorage.ts`
- `src/services/platform/window.ts`
- `src/services/platform/windowBootstrap.ts`
- `src/services/platform/tabWorkspace.ts`

The important architectural point is that cross-window movement is based on transferable tab session state rather than reopening the document from scratch whenever possible.

## Editor State

The editor single source of truth is:

- `src/store/useEditorStore.ts`

This store holds both:

- document model state
- editor UI state

Examples:

- pages, fields, annotations
- current tool and annotation styles
- selected object
- zoom/page position
- sidebar and right-panel state
- undo/redo history

State helpers and selectors are split out to:

- `src/store/helpers.ts`
- `src/store/selectors.ts`

The general rule is:

- persistent, user-visible editor state belongs in the store
- heavyweight runtime resources do not

Examples of non-store runtime resources:

- worker instances
- disposal callbacks
- some transferred tab-session resources

## PDF Pipeline

The PDF pipeline lives in:

- `src/services/pdfService/index.ts`
- `src/services/pdfService/pdfWorkerService.ts`
- `src/services/pdfService/pdfRenderer.ts`
- `src/services/pdfService/workerProtocol.ts`

Responsibilities are split roughly like this:

- `pdf-lib`
  - PDF mutation and export
  - form and annotation write-back
  - metadata-oriented document manipulation
- `pdfjs-dist`
  - rendering
  - text extraction
  - outline/destination support

### Why a Worker Service Exists

Rendering is coordinated through `pdfWorkerService` so the workspace can:

- render visible pages without blocking the main thread
- reprioritize work around the viewport
- cancel stale render requests
- reuse already-loaded PDF data across page-level rendering tasks

## Workspace Rendering Model

The editor page shell is:

- `src/pages/EditorPage/index.tsx`

The rendering and interaction core is:

- `src/components/workspace/Workspace.tsx`

The workspace combines:

- rendered PDF page layers
- annotation and control overlays
- hit-testing and selection
- dragging/resizing/editing interactions

Important supporting areas:

- `src/components/workspace/layers/`
- `src/components/workspace/controls/`
- `src/components/sidebar/`
- `src/components/properties-panel/`
- `src/components/toolbar/`

The control system is registry-driven. New form controls or annotation-like tools should be added through the existing control registration flow instead of introducing special-case rendering paths.

## Platform Abstraction Layer

Platform-specific concerns are isolated in:

- `src/services/platform/runtime.ts`
- `src/services/platform/files.ts`
- `src/services/platform/app.ts`
- `src/services/platform/window.ts`
- `src/services/platform/ui.tsx`
- `src/services/platform/documentSession.ts`

This layer exists to keep `App.tsx` and the editor UI from having to know about:

- Tauri plugin APIs
- browser file picker APIs
- browser drag-and-drop file handles
- desktop window lifecycle events
- platform-specific persistence details

As a rule, new platform conditionals should go into `src/services/platform/*` first, not directly into UI components.

## Browser Persistence

The browser-side persistence foundation is:

- `src/services/browserDb.ts`

It provides the IndexedDB setup used by browser recent-files storage. The browser recent-file path stores file handles separately from the recent-file metadata record so metadata can stay lightweight while still supporting reopen flows.

## Optional AI and Translation Layers

AI is optional and should be treated as an enhancement layer, not as the primary architecture.

Relevant modules include:

- `src/services/ai/`
- `src/services/translateService.ts`
- `src/services/pageTranslationService.ts`
- AI-related panels inside `src/components/properties-panel/`

These features should be integrated through service boundaries and editor actions rather than by coupling provider-specific logic into core workspace components.

Provider runtime compatibility, reasoning controls, and transcript persistence
live under `src/services/ai/providers/` and `src/hooks/useAiChatController/`.

## Extension Points

### Add a New Form Control

Update the control system rather than adding one-off rendering branches:

- control types in `src/types.ts`
- control components under `src/components/workspace/controls/`
- registration in the control registry
- parser/exporter support in `src/services/pdfService/` if round-trip PDF support is required

### Add a New Annotation-Like Tool

Touch the same broad areas:

- tool type definitions in `src/types.ts`
- workspace interaction logic
- control/annotation registry
- export support if it needs to be written back to PDF

### Add a New Language

Add a locale file under:

- `src/locales/`

The language provider loads locale modules dynamically, so new dictionaries should follow the existing module shape.

### Add a New Platform-Specific Capability

Prefer extending:

- `src/services/platform/*`

before changing higher-level UI code. This keeps platform branching localized and easier to audit.

## Desktop Host

The desktop host lives in `src-tauri/`.

Important areas:

- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/`
- `src-tauri/src/lib.rs`

The Tauri layer should remain thin. Most product logic should stay in the TypeScript application unless a capability truly requires native-side handling.

## Architectural Conventions

Current conventions worth preserving:

- Keep the editor store as the single source of truth for active document/editor state
- Use services for file, platform, and persistence boundaries
- Keep browser and desktop recent-file backends behind a shared interface
- Restore editor UI state through one global session path instead of multiple competing persistence systems
- Prefer extending existing registries and pipelines over adding parallel special-case systems
