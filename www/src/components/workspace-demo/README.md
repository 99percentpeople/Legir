# Source-backed interactive workspace demo

The desktop public site uses an HTML sample document and a local controller,
without an iframe or the PDF editing runtime. UI structure is based on the
checked-in application source. Below 768px or on touch devices without hover,
the site switches between static images of the six presets and does not import
or mount this runtime, including in phone landscape orientation.

## Application components reused

| Demo area                                                          | Application source                                                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Right panel frame, header, resize handle and footer                | `src/components/properties-panel/PanelLayout.tsx`                                                          |
| Model picker, chat history, messages and message actions, composer | `ModelSelect`, `SessionHistoryPopover`, `ConversationTimeline`, `ConversationEmptyState`, `ComposerFooter` |
| Vertical document / AI / translation dock                          | `RightPanelTabDock`                                                                                        |
| Desktop page navigation and layout controls                        | `FloatingBar`, `PageNumberDropdownControl`, `PageSettingsDropdownControl`                                  |
| Mobile bottom toolbar                                              | Shared `FloatingBar`, `ResponsiveToolbar`, `ToolPicker`, `useToolOptions` with local command callbacks     |
| Toolbar zoom and annotation color menus                            | `ZoomDropdownControl`, `ColorPickerPopover`                                                                |
| Document tabs                                                      | `EditorTabStrip.css`, with the same Home tab and active-tab shoulders                                      |
| Page editing                                                       | `getPageGridLayout`, `ResponsiveToolbar`, and the same pointer/keyboard drag sensors                       |
| Document information form                                          | `DocumentPropertiesPanel` (loaded on demand)                                                               |
| Fixed sample selection and five-action bar                         | App selection CSS and handle constants; `Button` layout follows `WorkspaceTextSelectionPopoverView`        |
| Fixed, contained translation card                                  | `TranslationWindowContent`, with a local frame following the app window header                             |
| Searchable outline and field tree                                  | `src/components/sidebar/OutlinePanel.tsx`, `FieldTreePanel.tsx`                                            |
| Annotation filtering, cards, editing, replies and deletion         | `src/components/sidebar/AnnotationsPanelView.tsx`                                                          |

`DemoToolbar` follows `Toolbar.tsx` and uses the same controls with local command handlers. `DemoSidebar` follows `Sidebar.tsx` and uses its tabs, input styles, width limits and resize hook. The main toolbar and sidebar containers cannot be mounted directly because they subscribe to the real editor store and PDF services.

The shared translation content and annotation views are also used by the application runtime wrappers. PDF permission checks and network translation remain in those wrappers. `AnnotationsPanel` still applies the application's PDF permission policy; the demo mounts `AnnotationsPanelView` with local data and callbacks, without importing the editor store or initializing a PDF worker. Outline and annotation views accept an optional scroll callback so their selection/focus logic scrolls only the embedded sidebar rather than moving the surrounding website. The dock's optional callback and scroll-container adapters let the demo handle translation locally without emitting application commands. Existing application callers retain their event-bus behavior.

## Geometry and state

`DemoPageEditor` follows the application's page grid and icon toolbar without
mounting the PDF runtime. Stable local page IDs keep selection and document
history attached to the correct page. The full page toolbar remains visible:
import, blank page, rotation, duplication, deletion and selection. The animation
uses a short authored flow through selecting, sorting, rotating, copying and
removing a sample page before returning to reading. Import opens the application;
local sample edits do not load or write PDF files. Thumbnails share the reader's
inert HTML content, page order and rotation.

`useDemoAutoplay` plays all six presets in sequence using local actions and a
decorative pointer. It demonstrates navigation, highlighting, form entry,
scripted AI output, translation and page organization. It starts only while the
demo is in view and the tab is visible. The icon control pauses/restarts playback;
pointer, keyboard or wheel interaction pauses it before manual commands run.
Changing presets starts that preset's sequence. Reduced-motion users start with
playback paused. Timers, pointer animations and scripted streaming are cancelled
when playback stops or the preset changes. Animation steps scroll only inner
document/thumbnail containers and never focus fields or scroll the website.

`demoMotion.ts` owns cancellable animation completion, frame timing and scrolling.
Steps wait for the pointer to arrive before pressing a control; clicks release
before typing, whose cadence pauses at punctuation. Automatic page sorting drives
the same drag manager as the pointer and keyboard sensors. `useDemoPageDrag`
previews insertion order while neighboring cards slide into place, matching the
application's page grid. A drop commits one history entry; cancellation restores
the original order. Preview and drop animations account for the editor's display
scale. Collision targets stay at their layout slots while only card contents
animate, preventing an outgoing neighbor from reversing the insertion. A press
during automatic dragging hands the same pointer gesture to manual control after
cancellation. Stale gestures cannot overwrite subsequent page edits. Rotation,
insertion and deletion have short transitions. Each scene is prepared
in one reducer action behind a brief document fade, with a fresh navigation token,
so completed fields or answers do not flash before the demonstration starts.
AI and translation results finish streaming before their reading pause begins.
Animated navigation keeps the destination thumbnail selected while scrolling
past other pages. Visible-page tracking resumes at completion or cancellation,
so intermediate frames cannot flicker the selection or pull the sidebar back.

The surrounding site uses one 4:3 workspace frame and an accessible preset
switcher, with icon-only playback/reset actions on desktop. The frame is capped
at 960px wide and reserves room for the site header and controls on shorter
screens. A 1200 × 900 editor surface scales with the frame, keeping every toolbar
button visible. `displayGeometry.ts` converts viewport measurements back to
editor coordinates for scrolling and the animated pointer. Fullscreen uses the
available screen at its normal scale. Manual page drags measure the paper rather
than the whole card, and render a `DragOverlay` outside the scaled editor (inside
the fullscreen element when present). The preview uses viewport coordinates for
pickup, movement and drop, avoiding a second application of the editor's zoom.
The site does not add another panel border
or repeat instructions around the editor. AI and translation panels still
identify their scripted examples.

`geometry.ts` uses the application's PDF-point/CSS conversion and fit-screen/fit-width functions. The A4 sample has fixed 595 × 842 PDF-point geometry. All presets default to **fit width**, not fit screen: the sheet fills the canvas horizontally instead of shrinking to show its entire height. Fit screen remains an explicit toolbar option. Zoom scales the whole HTML page; it does not reflow its text. Spreads, page direction, toolbar height and initial side-panel widths follow application source. The display uses a compact 16px canvas inset instead of the full editor's 96px fit-width allowance, including on phones. Responsive decisions use the embedded editor's width.

`DemoDocumentContent` supplies both the reading surface and live HTML thumbnails. Thumbnail fields are inert text representations, not duplicate inputs or document IDs; highlights and form values stay synchronized. `DemoThumbnails` scales the same fixed document geometry to the actual thumbnail width.

`types.ts` owns local document state, undo/redo snapshots (including annotation text and replies), form values, active tools and navigation. `useDemoNavigation` separates explicit page commands from scroll feedback: manual scrolling updates the page indicator without snapping back, clicking the current thumbnail still navigates to its top, and zoom preserves the reading position. `WorkspaceDemo` connects these to the UI. Translation is an independent card, not a mutually exclusive right-panel tab; it can remain open alongside AI. It is absolutely positioned **inside `.demo-editor-body`**, above the bottom toolbar, with container-relative size limits. It has no body portal, drag state, resize handles or viewport-level position. Opening it stages the fixed sample quote above the card by scrolling only the inner canvas, with the translation scene's page indicator pinned to its source page. The right dock's first button opens document information, not the outline. On small screens, the sidebar and right panel float over the document and are mutually exclusive, with the application's dimmed backdrop and Escape/outside-click dismissal. Resizing across the mobile breakpoint does not replay a preset or discard the current page, tool, or translation window.

The synthetic PDF in `www/src/assets/workspace/reading-notes.pdf` is a reference used to compare the real app in a browser. It is not rendered or downloaded by the website.

## Deliberate demo limits

- `DemoTextSelection` displays one fixed quote. It uses the application's blue selection fill, selection-handle CSS and size constants, but the handles are inert decoration. Demo-scoped overrides align the end circle's **top** with the lower stem endpoint, and the start circle's **bottom** with the upper endpoint; neither circle is centered on an endpoint. Their 12px screen size stays constant through page scaling. Clicking the quote reveals an in-document action bar; there are no native selection ranges, selection-change listeners or handle-drag logic. Native selection is disabled on the sample paper, except in form inputs. The real application's selection and draggable translation window are unchanged.
- No editor store updates, real PDF writes, provider calls, or persistence of document/chat inputs. The public demo must not contain credentials.
- `copy.ts` contains authored responses and translations, explicitly labelled as local examples, **not live provider responses**. The model picker is labelled "Demo". Unsupported questions and selections receive an explanation, not an unrelated response.
- `useDemoPlayback` simulates cancellable streaming and honors reduced motion. Chat editing, regeneration and session switching operate on local examples.
- `demoTokenUsage.ts` feeds the existing `ComposerFooter` context / total counters and input / output tooltip with deterministic **simulated** usage, not provider telemetry, billing or an exact tokenizer. A sample prompt/document allowance seeds each new request. Input is counted once; output follows only the visible playback text and freezes on stop. Context tracks retained conversation separately from cumulative request usage; simulated reasoning, when enabled, is included in output rather than added to total twice. Timeline snapshots restore session statistics and replace usage when an edited/regenerated local branch discards later messages. New chat starts at zero; Reset restores the seeded example. Drafts are not counted as sent requests. No additional stats bar, per-message widgets or model-capacity claims are added.
- The sample supports navigation, page zoom/layout, highlight toggling, annotation search/filtering, remark editing, replies, removal, undo/redo and form input. Tool selection is not a complete drawing or form-design engine. Save changes only the local demo's dirty indicator; it does not export a PDF. Full-page translation is disabled and control-property editing is not exposed.
- Manual preset changes retain form values while playback is paused. Starting a scene restores its sample state; Reset or a language change remounts local state. Theme changes use application tokens without resetting document state.

## Verification

Run `bun run test tests/www`, `bun run lint`, `bun run build:www`, and `bun run build` after shared-view changes. The integration tests mount the actual panel, composer, selectors, message components and sidebar views. The third-party decorative logo is stubbed for Node ESM compatibility; a fail-fast editor-store mock also ensures the public demo never imports the PDF editing runtime.

Browser verification should check the default sheet width, fixed selection and inert handles (circle edge meets stem endpoint, including at mobile scales), and translation-card containment during outer-page scrolling, viewport changes and attempted dragging/resizing. Check token tooltip values, streaming/stop behavior, session restore and localized number formatting as well. Also inspect the shared menus, chat actions, side-panel resize, mobile bottom toolbar, theme colors and absence of provider/worker requests. The demo intentionally keeps translation in the compact tabbed layout rather than reproducing the application's resizable-window breakpoint.

For manual page dragging, check that the grabbed point and paper size stay aligned
at different frame scales and in fullscreen. Verify reorder, drop animation,
Escape cancellation and undo, including taking over while autoplay is running.
