# AI Service Architecture

`src/services/ai` is split into three main areas:

- `chat/` owns multi-turn document assistant conversations and AI tools.
- `providers/` owns provider configuration, model discovery, model metadata,
  and provider-specific runtime adaptation.
- `tasks/` owns one-shot AI workflows such as translation, summarization, and
  page-image analysis.

The rest of this directory contains public entry points, state bridges, caches,
shared types, and utilities used by those three areas.

## `chat/`

`chat/` is the conversation layer. It should know how to run a document chat
turn, prepare messages, execute tools, apply chat memory, and persist streamed
assistant output. It should not know provider API request shapes directly.

### Main Files

- `chat/aiChatService.ts` orchestrates a chat turn: resolve the selected model,
  prepare messages, configure reasoning replay, register tools, call
  `streamText`, and emit assistant/tool/usage updates.
- `chat/aiToolRegistry.ts` defines the registry used to expose tool definitions
  and handlers to the AI SDK runtime.
- `chat/aiToolContext.ts` defines the document/editor context available to tool
  handlers.
- `chat/documentContextService.ts` collects document context for chat.
- `chat/prompts.ts` owns the chat system instruction and prompt fragments.
- `chat/types.ts` owns chat-specific records, tool contracts, and stream update
  types.
- `chat/workspace.ts` defines the current-window document access boundary.
- `chat/workspaceToolRegistry.ts` wraps document tools with `{ document_id, args }`
  targeting and adds `list_open_documents`. Default targets are fixed per turn;
  explicit targets can be any open tab. Each execution uses that document's
  store, worker, event bus and lifetime signal. Never route a missing/closed ID
  to the currently active tab.

### Conversation Ownership

The application mounts one lazy `GlobalAiControllerHost` under
`src/app/ai/GlobalAiContext.tsx`, outside document-tab trees. All panels share
its controller, history and composer. Hiding or switching a tab does not abort
AI; closing a document cancels operations targeting that document, while the
conversation remains available.

History is unified under `app-ai-chat:workspace`. `unifiedHistory.ts` imports
legacy per-document histories once, retaining their original storage entries as
backups. Search results, message attachments and navigation links carry document
IDs to prevent collisions between PDFs. IDs refer to live tabs; stale history
links do not silently point to a newly opened document. This is a current-window
workspace, not a cross-window document/AI coordinator.

### Runtime Helpers

`chat/runtime/` contains provider-agnostic chat runtime helpers:

- `messageContext.ts` converts persisted chat records into AI SDK messages.
- `reasoningReplay.ts` strips or keeps reasoning content according to the
  provider runtime replay policy.
- `toolRuntime.ts` executes registered tools and reports tool lifecycle updates.
- `requestRecovery.ts` handles retry/recovery behavior around model requests.
- `imageCompression.ts` prepares image payloads for model context.
- `internalContext.ts` and `contextMemory.ts` build hidden/internal context.
- `compression/` decides when and how to compress long conversations.
- `memory/` plans, applies, and serializes conversation memory.

### Tools

`chat/tools/` contains document-facing tools:

- `documentTools.ts` reads document metadata, page text, and page images.
- `annotationTools.ts` creates or updates annotations.
- `formTools.ts` handles form-related operations.
- `navigationTools.ts` exposes document navigation actions.
- `shared.ts` holds common tool validation and document helper logic.

Shared permission and document-operation checks belong in the tool/helper layer
or the underlying document service, not in provider adapters. This keeps user
actions and AI tool actions aligned when they call the same lower-level
functions.

## `providers/`

`providers/` is the provider and model resolution layer. It should answer:

- Which providers are configured?
- Which models are available for a task?
- What are a model's capabilities?
- Which AI SDK provider/model object should be used?
- Which provider-specific runtime options are required?

It should not run document chat turns or implement document tools.

### Connections and catalog

`AppOptions.llm` is a dynamic record keyed by stable connection IDs. Each entry
stores its name, optional models.dev `catalogId`, protocol (`backendKind`), saved
base URL, credential, authentication mode and enabled state.
Multiple connections can use the same provider with different accounts/endpoints.
Settings adds providers through a searchable dropdown and displays each connection
in an independently collapsible row. Newly added connections open automatically;
enable and remove actions remain available on collapsed rows.
Catalog connections use the current provider name and SDK authentication by
default, without name or authentication editors. Multiple connections to the
same provider receive numbered labels, shared by settings and model selectors;
their IDs and model selections remain stable. Custom connections retain editable
names and protocol-appropriate authentication choices: SDK default, no
authentication, and an explicit Bearer override for Anthropic-compatible APIs.
Existing non-default authentication remains active and is shown with an explicit
reset action. Switching protocols clears an override only when the new adapter
cannot use it; no-auth connections remain no-auth.
Model selectors continue to use `connectionId:modelId`; colons inside a model ID
are preserved. Credentials remain user settings, never build-time variables.

- `connections.ts` normalizes connections and migrates old preferences. The
  frozen `legacyProviders.ts` is only a migration schema, not an active provider
  registry. Configured legacy IDs, endpoints, credentials and selected API modes
  are retained; unused placeholders are omitted. Replacing the connection map
  permits deletion without resurrecting defaults on reload.
  It also resolves automatic display names and supported authentication modes.
  The persisted `api-key` mode means SDK default authentication, including Bearer
  headers for OpenAI-compatible APIs; it is not a separate header override.
- `catalog.ts` maps supported SDK packages to executable protocols. Provider
  names and available models are data, not an enum. Unsupported SDK/authentication
  integrations are excluded instead of assuming every catalog entry is runnable.
- `connectionProtocols.ts` limits catalog connections to the wire format declared
  by their SDK; models.dev does not enumerate every compatible protocol. Native
  adapters share readable format labels. Only custom connections offer all formats.
  Settings hides the format field when no supported alternative can be selected.
  Unlisted saved formats remain visible but cannot be newly selected. Explicitly
  choosing the catalog format also restores its default endpoint; merely opening
  settings or refreshing the catalog never changes saved configuration.
- `modelsDev.ts` loads a bundled snapshot lazily, restores the last valid cached
  catalog, and refreshes `https://models.dev/api.json` with a 24-hour TTL. Catalog
  fetches carry no provider credentials. Invalid/failed responses retain the last
  valid catalog. Refresh never changes saved connection URLs or keys.
- `models-dev.snapshot.json` is generated data, not hand-maintained. Regenerate it
  with `bun run update:ai-catalog` (or pass a downloaded API JSON file as the next
  argument). It is lazy-loaded separately from normal PDF startup. Runtime
  catalog refresh does not require rebuilding the application. The source catalog's
  MIT license is retained in `public/models-dev.LICENSE.txt`.
- `settings.ts` resolves a saved connection; `registry.ts` selects its protocol
  adapter. Connection IDs and provider/SDK option namespaces are separate, so
  multiple connections retain the correct reasoning parameters.

### Model discovery and capabilities

`modelCatalog/base.ts` owns endpoint discovery for the supported protocols,
including pagination, authentication and the shared web/Tauri proxy. A successful
endpoint listing is authoritative for that connection's available models. The
catalog supplies an offline fallback and fills missing model facts; a 404/405
listing falls back to it. An empty successful listing remains empty. Catalog
entries alone do not establish account access or authenticate credentials.

Explicit endpoint capability fields override catalog facts. Model lists come from
endpoint discovery and the catalog; manually configured models and capability
overrides are no longer supported. Legacy custom model fields are removed during
preference normalization. Unknown models are not assumed to support tools or
images. Image input and image tool-result support remain distinct.

`modelCache.ts` keeps model lists per connection, with a one-hour freshness limit
and a configuration fingerprint. Changes to endpoints, authentication or proxy
settings invalidate cached results. Late responses from edited or deleted
connections cannot restore stale lists. Failed refreshes retain prior results.
`modelSelection.ts` builds groups from connections, and `modelResolver.ts`
resolves selected models and task requirements.
Model choices include only enabled connections with a valid HTTP(S) endpoint and
a nonblank key/token, or explicit no-authentication mode. This is a local
configuration check; it does not certify that a server accepts the credential.
The same gate applies to catalog fallback and previously fetched models. Changes
to connection settings update all model selectors and translation registrations
immediately, without waiting for model discovery. Provider settings remain visible
so disabled or incomplete connections can still be configured.
Deleting a connection also removes its translation registry group. Explicit
requests targeting a removed connection fail instead of using another account.

### Runtime and reasoning

The AI SDK remains responsible for generation, streaming and tool execution.
`runtimeAdapters/` contains protocol-specific thinking settings and message replay
requirements. The shared proxy is injected as `fetch` for both discovery and model
calls. Authentication can be disabled for local compatible endpoints.

`metadata.ts` and `reasoning.ts` read model facts and thinking controls from
models.dev. There are no model-name or family rules for reasoning. Adapters use
the connection's catalog identity, independently of its connection ID and SDK
option namespace. Catalog refresh recomputes the active chat model's controls.

`reasoning_options` supplies effort values, toggle support and token-budget bounds.
Effort choices retain their exact meanings, including distinct `xhigh` and `max`.
Budget-only models use shared low/medium/high token presets bounded by the
catalog's minimum, maximum and output limit. These presets are translated to
token budgets, not sent as effort values. Toggle-only models expose off/auto.
Models without catalog controls use automatic behavior; missing models are never
inferred from their names. Existing `xhigh` preferences select `max` when only the
latter exists.

`runtimeAdapters/catalogReasoning.ts` translates these controls to the installed
SDK's wire format. SDK enum restrictions may further limit the available effort
values. Generic OpenAI-compatible endpoints support the standard effort field;
provider-specific toggle and budget fields require a protocol adapter rather
than guessing their request shape from a model name. Metadata never loads code.

The UI retains display controls. Replay rules,
image tool-result handling, document targeting, chat history and tool permissions
remain owned by their existing layers.

## `tasks/`

`tasks/` implements one-shot AI workflows. These functions are not chat turns and
do not execute the chat tool registry. They should accept explicit `appOptions`
and a model specifier so callers and tests can control provider selection without
reading UI state.

- `translateText.ts` translates plain text.
- `translatePageBlocksStructured.ts` translates page text blocks with structure.
- `summarizeText.ts` summarizes text, including conversation-memory input.
- `summarizePageImages.ts` summarizes rendered page images with a vision model.
- `tasks/index.ts` exports task implementations.

Task implementations may use `resolveAiSdkRuntime` or
`resolveAiSdkLanguageModelDetailed`, but provider-specific request behavior
should stay in `providers/runtimeAdapters/`.

## Shared Entry Points and Helpers

- `index.ts` re-exports the supported public surface for the rest of the app.
- `taskRunner.ts` keeps legacy task-style entry points such as `translateText`
  and `summarizePageImages`; it bridges current editor options into task
  implementations.
- `editorState.ts` is the narrow bridge to the editor store for legacy service
  entry points.
- `modelCache.ts` manages cached provider model lists.
- `translation.ts` contains translation-specific shared behavior.
- `types.ts` contains AI service-level task option types.
- `utils/` contains pure AI helpers such as document links, geometry,
  page-coordinate conversion, streaming JSON, prompt helpers, and tool-case
  conversion.

Shared app constants, including the default model context window, live in
`src/constants.ts`.

## End-to-end Flow

### Chat

1. UI calls `chat/aiChatService.ts`.
2. `providers/modelResolver.ts` resolves the selected provider/model.
3. The connection resolves its model catalog and `providers/registry.ts`
   selects the protocol runtime adapter.
4. The runtime adapter contributes provider-specific call options and replay
   rules.
5. `chat/runtime/` prepares messages, memory, compression, and tool execution.
6. `aiChatService` calls `streamText` and emits streamed text, reasoning, tool,
   and usage updates.

### One-shot Task

1. UI or legacy code calls `taskRunner.ts` or a `tasks/` function.
2. The task resolves a provider/model through `providers/modelResolver.ts`.
3. The task calls the AI SDK with the resolved model and runtime call options.
4. The task returns structured output to the caller.

## Extension Rules

- Providers using supported protocols enter through models.dev or a custom
  connection; do not add provider allowlists or duplicate model facts locally.
- Add new protocol/SDK support in `catalog.ts` and `registry.ts` with transport
  tests. Remote npm package names are data, not executable import instructions.
- Add provider request-shape behavior in `providers/runtimeAdapters/`.
- Add chat tools in `chat/tools/` and register them through
  `chat/aiToolRegistry.ts`.
- Add one-shot workflows in `tasks/`.
- Keep UI state and display logic outside this service layer except for the
  narrow bridges in `taskRunner.ts` and `editorState.ts`.
