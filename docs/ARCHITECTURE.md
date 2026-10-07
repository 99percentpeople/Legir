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
    useBootstrapAwareBrowserLocation.ts

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
    useEditorView.ts        Active and document-scoped read models
    editorView.ts           Composes state owners and document commands
    preferencesStore.ts     Shared settings and tool defaults
    workspaceStore.ts       Window layout and tab ordering
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

The app uses a browser path router through `useBootstrapAwareBrowserLocation`, with a bootstrap-aware override that can route startup document windows to `/editor`.

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

Persistence follows state ownership:

- Recent files store lightweight metadata and previews.
- `legir.preferences` stores app options, annotation style defaults and translation defaults through `src/store/preferencesStore.ts`. Fetched model caches are transient.
- `legir.workspace-layout` stores panel visibility, selected sections, widths and page arrangement through `src/store/workspaceStore.ts`. Active tabs, dialogs, floating mode and fullscreen are transient.
- `legir.document-views` stores each document's zoom, page and scroll position under its source key, through `src/services/platform/documentSession.ts`.

The previous `app-editor-ui-dev` and `app-editor-ui-session` formats are not read or migrated. Layout and preferences have one persistence owner; document updates do not write these preferences.

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
5. The matching document viewport is restored; shared UI is read from its existing owners
6. The tab is inserted into the current editor window
7. The route switches to `/editor`

The file-open abstractions deliberately hide the platform differences:

- Web uses browser file handles where available
- Desktop uses Tauri dialog and filesystem APIs

## Editor Tab and Window Model

Legir treats each open document as a live tab session. Every tab owns an independent Zustand store, React editor tree, PDF worker, canvas buffers, scroll position, search state and undo/redo history. Switching tabs changes visibility and the active editor-view reference; it does not restore a snapshot into another document's store.

Window layout is held once by `workspaceStore`, and app preferences are held once by `preferencesStore`. Document stores do not contain copies of either. Existing and newly opened tabs read these shared owners directly. Only foreground selection changes may automatically switch the properties panel. Zoom, reading position, selection, search results and document-attached translation windows remain scoped to their document.

The core types live in:

- `src/app/editorTabs/types.ts`

Important concepts:

- `EditorTabSnapshot`
  - a serializable view of editor state for one document
- `EditorTabSession`
  - live runtime + worker/service/resource ownership; titles and dirty flags come from document state, thumbnails from the resource store, and snapshots are created on demand for window transfer
- `EditorTabRuntime` (`src/app/editorTabs/runtime.ts`)
  - independent store, private workspace event bus, DOM root, scroll container and lifetime cancellation signal
- `EditorWindowLayout`
  - tab ordering and active-tab selection for a window

### Snapshot Creation and Restore

Tab snapshot logic lives in:

- `src/app/editorTabs/storeSnapshot.ts`

This module handles:

- creating a snapshot from the live editor store
- creating the initial snapshot after loading a PDF
- deriving stable source keys for deduplication
- constructing a new document owner from an imported snapshot, using the target window's existing preferences and layout

`src/pages/EditorPage/KeepAliveEditor.tsx` mounts every open tab with a stable key. Inactive tabs use `visibility: hidden` and `inert`, retaining layout dimensions, scroll offsets and transferred OffscreenCanvas buffers. Only the active tab handles global keyboard/pointer shortcuts. Body-portaled menus, popovers, tooltips and dialogs also honor tab activity and release focus/pointer locks while hidden. Workspace events and DOM queries are scoped through `src/app/editorTabs/context.ts`; identical page/control IDs in separate PDFs must not resolve into another tab.

There is currently no LRU eviction: closing a tab releases its worker, canvas resources, thumbnails, subscriptions and cancellation signal. Memory therefore grows with open documents. Page virtualization still bounds each document's mounted pages.

Save operations capture the originating store and exported revision before awaiting I/O. Completion updates only that store; edits made during a save remain dirty.

### Multi-Window Support

Tab and window transfer support lives in:

- `src/app/editorTabs/transfer.ts`
- `src/app/editorTabs/transferStorage.ts`
- `src/services/platform/window.ts`
- `src/services/platform/windowBootstrap.ts`
- `src/services/platform/tabWorkspace.ts`

The important architectural point is that cross-window movement is based on transferable tab session state rather than reopening the document from scratch whenever possible.

## Editor State

State is divided into independent owners:

- `src/store/preferencesStore.ts`: app options, tool styles, translation defaults and transient model caches.
- `src/store/workspaceStore.ts`: structured `layout.sidebar` / `layout.rightPanel`, page arrangement, window tab layouts, typed dialogs and fullscreen/floating state.
- The document store created in `src/store/editorView.ts`: PDF data, permissions, edits, selection, tools, viewport, history and document job status.
- A separate resource store per document: thumbnail URLs, never persisted or transferred.

`EditorState` / `EditorStore` describe a composed read model. `EditorView` caches a projection of owner references and exposes document-bound commands; it owns no writable data and has no bidirectional synchronization. Commands dispatch patches to the appropriate owner. `EditorViewContext` binds the editor tree to its document view. Sidebars read `useWorkspaceStore()` directly, and the canvas subscribes separately to document, preference and layout selections.

`src/store/useEditorView.ts` exposes the document-bound hook and the window's active view reference. Imperative document work receives an explicit `EditorViewApi` or uses `useEditorViewApi()`. Global configuration services read `preferencesStore` directly. Changing the active document never replaces preferences or layout.

`EditorTabSnapshot` is an explicit whitelist of document fields, excluding UI, preferences, jobs and resource caches. `EditorTabSession` contains identity and live resource ownership, with no duplicate document snapshot, title, dirty flag or thumbnail map. Tab descriptors are derived for rendering; hydration patches the originating document directly. Normal activation persists only the small viewport record.

State defaults and selectors are in `src/store/helpers.ts` and `src/store/selectors.ts`. Processing queues and thumbnail cancellation remain local to the originating document view.

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

`src/app/ai/GlobalAiContext.tsx` owns one lazily initialized AI controller per window. Panels share its conversation, history, composer draft and attachments. The controller remains mounted independently of tab/panel visibility, so switching tabs does not abort a turn. Translation tasks remain owned by their originating document.

History uses the unified `app-ai-chat:workspace` storage key. Legacy per-document histories are merged once without deleting their source keys. Workspace history does not apply the legacy 20-conversation cap; per-conversation size limits and browser storage quotas still apply. Quota failure retains the last durable history instead of replacing it with one conversation. Concurrent cross-window history synchronization is not implemented.

`src/services/ai/chat/workspaceToolRegistry.ts` exposes `list_open_documents` and routes document tools using `{ document_id, args }`. IDs cover the documents in the current window. An omitted ID is pinned to the document active at the start of that turn, not whichever tab happens to be active later. Explicit IDs allow reading/editing other open documents with their own workers, stores and permission checks. Closing a document cancels its tool operations; missing IDs never fall back to a different document. Document links and attachments retain their document IDs.

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

- Keep each document's store as the single source of truth for that document/editor state
- Use services for file, platform, and persistence boundaries
- Keep browser and desktop recent-file backends behind a shared interface
- Restore editor UI state through one global session path instead of multiple competing persistence systems
- Prefer extending existing registries and pipelines over adding parallel special-case systems
