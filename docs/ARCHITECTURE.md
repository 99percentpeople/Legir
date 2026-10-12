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
    page-editor/            Page structure editing and virtual thumbnail grid
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

The app has one persistent workspace shell and tab strip. Home is a permanent,
non-closeable, non-draggable entry before the document tabs. All tabs share one
horizontal scrollport, including Home; mouse-wheel input scrolls the strip
horizontally while modifier-based zoom gestures retain their native behavior.
Routing selects the visible page, not whether the workspace is mounted:

- `/` selects Home with no active document.
- `/editor/:tabId` selects a live document session in this window.
- `/editor` remains a bootstrap/legacy entry. It waits for pending opening or
  transfer work, then resolves to a document route (or Home if none exists).
- Unknown, expired and foreign-window session routes are replaced with `/`.

`src/app/workspaceNavigation/` owns URL parsing and navigation commands. Explicit
page selection pushes history; selecting the same page is a no-op. Closing the
active document replaces the current entry with its right neighbor, then its left
neighbor, then Home. Browser history is projected back into the document runtime
and workspace layout without pushing another history entry. Window layout
`activeTabId` is null on Home even when documents remain open. These addresses
identify transient sessions, not persistent file links; refresh does not restore
tabs or unsaved edits.

Home is lazily mounted on its first visit and retained afterward, preserving its
query and scroll state. Document trees stay mounted until closed. Inactive Home
and document views are inert; file-drop handlers and document shortcuts only run
for the visible page. Window titles and browser unload protection are app-owned,
so dirty background documents remain protected while Home is selected.

### Component preloading

`src/app/componentModules.ts` owns the shared preloadable route, canvas and dialog
instances. PDF opening warms the editor route, reading workspace and password
dialog alongside file I/O. The idle app warms other routes and common dialogs;
an active, ready document warms the page editor before the secondary right-panel
branches. Mode and dialog controls also preload on pointer/focus intent.
The AI controller is downloaded with the AI panel but mounted only on request.

`src/utils/preload.ts` shares the loader promise between preloading and rendering,
prepares the resolved lazy component to avoid a first-use fallback flash, and
allows retries after background failures. `src/lib/schedulePreload.ts` runs one
task per idle turn, with a timer fallback and cancellation when its owner changes.
Preloading never mounts components or creates document/AI runtimes. Opening a
feature before preload completes retains normal Suspense behavior.

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
- Custom stamp images live in IndexedDB under `stamp-image:` keys in the workspace store, through `src/services/stampLibrary/`. `src/store/stampLibraryStore.ts` shares the list across editor tabs and sorts it by last use, falling back to creation time for older entries. Placed annotations retain their own image resource, so removing a library entry does not change a document.
- Image stamp `appearance.scaleMode` selects `contain` (default) or `fill` for both workspace display and PDF appearances. `FFStampImageScaleMode` preserves the choice and full annotation bounds across PDF saves; restoring the original ratio changes the rectangle around its center without changing the source image or display mode.
- `options.imageCompression` selects original resolution or a target DPI for newly exported image stamps. Export downsamples according to physical image dimensions in PDF points (including page `UserUnit`), independently of viewer zoom. Image resources in the editor and library remain original; unchanged imported annotation appearances and SVG vectors retain their existing preservation path.
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
7. Unified navigation selects `/editor/:tabId`; re-opening the same source selects
   the existing session instead of creating another tab

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

`src/pages/EditorPage/KeepAliveEditor.tsx` mounts every open tab with a stable key. Document hosts are ordered by immutable session ID, independently of the user-visible tab order. Reordering the tab strip must not move existing document DOM: even keyed DOM moves can reset browser scroll offsets and replay canvas lifecycle effects in development StrictMode. Adding or closing a session only inserts or removes that session's host. Inactive tabs use `visibility: hidden` and `inert`, retaining layout dimensions, scroll offsets and transferred OffscreenCanvas buffers. Only the active tab handles global keyboard/pointer shortcuts. Body-portaled menus, popovers, tooltips and dialogs also honor tab activity and release focus/pointer locks while hidden. Workspace events and DOM queries are scoped through `src/app/editorTabs/context.ts`; identical page/control IDs in separate PDFs must not resolve into another tab.

There is currently no LRU eviction: closing a tab releases its worker, canvas resources, thumbnails, subscriptions and cancellation signal. Memory therefore grows with open documents. Page virtualization still bounds each document's mounted pages.

Save operations capture the originating store and exported revision before awaiting I/O. Completion updates only that store; edits made during a save remain dirty.

### Multi-Window Support

Tab and window transfer support lives in:

- `src/app/editorTabs/transfer.ts`
- `src/app/editorTabs/transferStorage.ts`
- `src/services/platform/window.ts`
- `src/services/platform/windowBootstrap.ts`
- `src/services/platform/tabWorkspace.ts`

The important architectural point is that cross-window movement is based on transferable tab session state rather than reopening the document from scratch whenever possible. Home is never transferred or counted as a document. Transfer rollback restores the previous workspace page (including Home), without disposing the retained runtime.

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

`packages/pdfium` is an independent PDFium WASM/TypeScript package used by both
Web and Tauri. Its native bridge and pinned source patches supply:

- Parsing, repair, decryption, encryption and final serialization
- Page/tile/thumbnail rendering, including native form and annotation appearances
- Text extraction and geometry for selection, search, translation and AI
- Outlines, destinations, permissions and owner-password verification
- Content-level text removal and bounded page images for model-based OCR

`src/services/pdfService/engine/` is the engine boundary. Each open document
has one persistent `pdf-render.worker` and one native PDFium `PDFDocument` in
`DocumentSession`. Rendering, model hydration, export, text extraction, password
verification and OCR image generation all use that instance. The main thread
owns UI models, immutable source bytes and DOM font faces, never a parsed PDF
object graph. `index.ts` is the client; `documentPipeline.ts` runs in the worker.
`documentOwners.ts` routes operations on a loaded byte buffer back to its worker.

`NativeEditingContext` supplies lazy dictionary/array/stream views over the
native xref to the existing form, annotation, font-layout and page-assembly
helpers. `@cantoo/pdf-lib` remains an appearance/layout dependency; its facade
has no independent parsed xref or copied stream graph. Its parser, file writer
and encryption implementation are not used by the application. Unchanged stream
bodies are read only when a helper actually needs them. The adapter depends on
the pinned helper constructor/object vocabulary and PDFium bindings; upgrade
these with native-adapter, source-assembly and browser round-trip tests.

Hydration, thumbnail overlays and export use native journal transactions. The
UI/history models describe draft edits; success, failure and cancellation all
restore the immutable native source state after a job. Thumbnails draw a
short-lived transparent page in the same document, then roll it back. Export
uses the same xref and serializes through PDFium without reopening the input.
Page assembly rewrites the page tree while preserving source catalogs, inherited
page attributes, AcroForm fields and outline destinations.

Imported sources are grafted into the owning document's page bank, with source
catalog views and original-to-native reference mappings. A donor PDF is open
only during grafting (temporary peak: two native documents); it is then destroyed.
The native graft map traverses reachable objects and copies encoded streams
inside WASM. Source registration and removal update the page tree in a single
batch. Export copy groups use the same native map, including copies within the
owning document; the layout layer still reconnects selected form widgets,
namespaced fonts and page destinations. Native type/name-key access avoids
serializing temporary key buffers for each layout-helper lookup.
An import preview is a separate open document until its preview closes. Blank
pages are created directly in the owner. Source lifetimes include undo history;
unloading removes source pages/objects and invalidates cached pages. Native
journal/allocator storage can remain reserved until the worker closes. Closing
the editor terminates the worker and releases its entire WASM arena.

The worker serializes document jobs with rendering, retaining queue priorities,
canvas ownership, cancellation and logical-page routing. Queued commands can be
cancelled; native rasterization/serialization are synchronous and cannot be
interrupted mid-call. Each source page cache retains at most twelve native pages;
pixmaps and object handles are released explicitly. System-font bytes come from
the host through a narrow request/response bridge; embedded font bytes return once for main-thread `FontFace` registration.
Permission preferences are snapshotted into each export request.

`raster.ts:drawPageToCanvas` writes directly from the live PDFium pixmap to Canvas
before destroying the pixmap. Pixel access and `putImageData` stay synchronous;
no native allocation or async boundary may detach the borrowed WASM memory.
The bridge requests straight RGBA output from PDFium. Consumers that
retain/transfer pixels use `rasterizePage`, which still returns an owned copy.
Canvas resizing happens only after successful rasterization, preserving the
previous frame if native rendering fails.

Standalone content operations without a live owner use a disposable
`pdf-content.worker`; Node/test authoring also supports the native engine without
a browser worker. `objectGraph.ts` is restricted to standalone authoring/diagnostic
operations, not the live document pipeline. New application PDF operations must
route through the owner, never call the helper library's `load` / `save`. PDF.js
is a development-only independent reader; no runtime PDF.js assets are shipped.

`textTypes.ts` defines the application text-layer contract independently of the
engine. PDFium glyphs are mapped into original PDF coordinates, split at word,
font and direction boundaries, and consumed by the existing selection/search
code. `raster.ts` composes the native page transform with the UI viewport so
crop offsets, UserUnit, source rotation and temporary UI rotation agree.
Thumbnail rendering draws immutable page contents, retains only untouched or
unsupported source annotation appearances, then composites current editable
controls using a transparent native-rendered overlay.

`renderOcrImage` returns PNG bytes and `pixelToPdf` so an OCR provider can map
pixel-space results without guessing about rotation, crop origins, DPI or
UserUnit. It excludes annotations and widgets. No recognition model,
credentials or OCR text-layer persistence is implemented by this engine.

Saving flattened free text removes covered glyphs directly in the shared native
transaction, preserving images, line art and unrelated redaction annotations,
then draws replacement text before serialization. The bridge preserves original
encoded glyphs, spacing and unrelated content operators, including shared Form instances. Edits intersecting `/ActualText`
replacement strings currently fail rather than retain stale logical text.
Export fails if requested text removal fails. This is text replacement, not
document-wide sanitization.
The standalone authoring fallback can still stage affected pages; live documents
do not use that path.

The package's ESM loader, WASM binary, provenance and third-party notices are
copied under `pdfium/<source-revision>-<binary-hash>/`. The PWA precaches the
loader and binary so the first PDF can open offline after installation. Builds
verify that native sources, patches, toolchain pins and compiled assets match.
The wrapper is BSD-3-Clause; PDFium and linked libraries retain their bundled
notices. Legir remains AGPL-3.0-or-later. Browser and Tauri web builds share these
assets; native WebView behavior requires separate platform validation. V8 PDF
actions and XFA are disabled in this build.

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

The floating toolbar's page settings menu rotates the whole document's reading
view in 90-degree steps. Document-owned `viewRotation` is temporary, travels with a live tab during
window transfer, and resets when a document is reopened. It does not modify
`PageData`, dirty state, undo history or PDF export. Rendered viewports and page
layout use the combined source/view angle; overlays and pointer/text-selection
coordinates convert between that view and the original page coordinates. Future
saved page editing should use a separate document mutation path.

Important supporting areas:

- `src/components/workspace/layers/`
- `src/components/workspace/controls/`
- `src/components/sidebar/`
- `src/components/properties-panel/`
- `src/components/toolbar/`

The control system is registry-driven. New form controls or annotation-like tools should be added through the existing control registration flow instead of introducing special-case rendering paths.

### Tool selection and options

`src/components/toolbar/toolDefinitions.ts` exhaustively maps every `Tool` to its identity and supported style options. `EditorToolSelector` is the desktop selection-only strip; `ToolPicker` serves mobile selection and shape variants. Both use the same permission checks. The shared `FloatingBar` keeps pagination visible and adds options from `useToolOptions` plus an icon-only exit button for a non-default tool. Tools without configurable defaults still use the same context and exit control. Existing-object editing toolbars remain separate.

`ResponsiveToolbar` measures the available container and natural item widths with `ResizeObserver`. The toolbar stays on one line: trailing optional controls move into a More popover and return when space grows, while pagination, the current tool and exit stay pinned. Narrow layouts use compact navigation/tool triggers. Overflow controls reuse the same settings components and commands; inert, inaccessible measurement copies cannot open portals. Resizing or leaving the document dismisses transient menus without changing tool preferences.

Stroke options share `StrokePreview` and `StrokeWidthControl` across new-tool defaults and existing-annotation properties: one live preview at the top of each settings popover reflects color, width, opacity and dashes; width uses visual presets plus numeric entry. Shape border styles use a single visual solid/dashed dropdown, with density available only for dashed strokes. Opacity and dash density retain continuous sliders.

`useEditorToolActions` is the common selection/exit controller for the top strip, floating toolbar, canvas and Escape. Exiting synchronously cancels only in-progress interactions through the document-scoped event bus, clears selection/temporary pan, and returns to desktop selection or mobile pan without deleting committed edits or clearing style preferences. Escape is handled after popovers: close a popup, cancel an unfinished draft, then clear selection/exit. Shape draft completion and draft cancellation are separate commands. The floating toolbar unmounts its transient popovers when the tab is inactive, while the document remains alive; its measured height reserves bottom scrolling space on narrow/touch layouts.

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

## Page Structure Editing

The `pages` editor mode provides import, blank pages, duplication, deletion,
rotation and reordering. `pageEditingSlice` applies one atomic transaction per
operation, including fields, annotations, outline destinations, selection and
permission scopes. `historySlice` restores these together. Tab snapshots and
window transfers retain both page structure and imported source bytes.

Page cards always expose their actions. Click selects one page; Ctrl/Cmd,
Shift and the context menu extend selection. Shared actions remain visible and
are disabled when no pages are selected. Selection remains document-scoped.
Page controls render into the main toolbar's document-local host through a
React portal. Their dialogs, callbacks and selection stay owned by `PageEditor`;
no global command registry is needed. `ResponsiveToolbar` supplies the shared
inline/overflow layout, and `PageActions` serves both cards and header actions.
`pageThumbnailScale` stores thumbnail zoom independently of the reading scale.
The grid viewport preserves visible pages when wheel or toolbar zoom changes
column counts; virtualization and file-drop hit testing share its row height.
Square paper areas scale independently of the column count, so rotation keeps
the same thumbnail size and low zoom levels remain continuous. Grid padding and
minimum gaps scale with the thumbnails; columns distribute spare width using
`space-around`. Empty column tracks remain reserved for short documents, keeping
spacing stable when pages are added or deleted. Wheel anchors and file-drop
markers share that layout geometry.
`PageGridTransitions` captures visible cards before a structural edit commits:
new pages fade in, removed cards fade out as inert visual copies, and surviving
content slides to its new slot. Decoded thumbnail pixels survive URL retirement
without another PDF render. History commits immediately; sorting targets stay
fixed, scrolling/zoom cancels stale motion, and reduced motion skips transitions.
Cards, actions and drag previews are memoized with stable callbacks. Thumbnail
URLs are subscribed to per page so one rendered image does not invalidate the
grid. Native scrolling updates React only when the visible row range changes;
wheel zoom accumulates once per animation frame. Grid row sizing controls card
geometry without re-rendering their contents, and zoom mounts the destination
window directly instead of briefly requesting pages at the old scroll offset.
The virtual grid uses dnd-kit for pointer, touch and keyboard sorting. React
owns the tentative order; only drop commits a page transaction. External PDF
drops use the platform file-transfer reader, preserve the insertion gap and
open the import chooser. Multiple files are confirmed sequentially. Import
and full-page translation share `src/utils/pageRange.ts`.

Each page receives a stable `id` on its first structural edit. `source` identifies
an immutable PDF and source page; `copyGroup` separates independent copies.
Controls retain the source viewport coordinate system and their existing
`pageIndex` contract. Transactions remap indexes by page identity. Source object
references are resolved within each page's source/copy group at export.

`PDFWorkerService.configurePages` routes logical page requests to immutable
sources, loading imports and blank pages on demand. Its source lifetime includes
undo/redo history. The page grid renders visible rows with overscan and shares
thumbnail URLs with the sidebar. Editing does not rebuild the source PDF.

Live thumbnails are owned by `store/documentThumbnails.ts`. A per-document
subscription coalesces control edits, undo/redo and structural changes, then
compares page snapshots by stable identity. Only changed pages enter the serial
queue; reordering and CSS rotation retain existing URLs. The sidebar and page
grid share `useThumbnailViewport`: observed, actually visible pages go first,
then remaining pages in document order. Each job reads the latest visible set;
scrolling, virtualization and mode switches replace previous priorities without
discarding an in-flight render. Reader gestures and thumbnail zoom defer work,
while page dragging, scrolling and drop animations keep the queue running.
Drag previews retain their images until drop completes. The old image stays
visible until its replacement has decoded; canceled or stale results are
discarded before publishing.

`pdfService/thumbnailRenderer.ts` supplies the same encoding and snapshot bucketing
for the sidebar/page editor and the virtualized import preview. In the render
worker, unchanged native/unsupported annotations retain their source appearance;
edited controls use the shared PDF exporters on a small transparent single-page
overlay. This never reparses or serializes the full source document for an edit.
The import preview retains its rendered URLs until unmount. Reader canvas
placeholders live separately in `pagePreviewImages`, without controls, so they
cannot double-paint the live workspace overlays. Both resource caches follow
page identity through edits and are released when their document closes.

`exportPDF` assembles the final page sequence before exporting controls, repairs
copied AcroForm trees and internal links, and applies `rotationDelta` after
coordinate-dependent export. The independent `viewRotation` remains temporary.
Saving compares page/source references as well as controls so edits made during
an in-flight save remain dirty. See [page editing](PAGE_EDITING_MODE.md) for
interaction rules and remaining platform acceptance checks.
