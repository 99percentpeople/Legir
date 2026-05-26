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

### Provider Configuration

- `providers/catalog.ts` defines provider ids, labels, default base URLs, API
  options, fallback model ids, and provider-level settings metadata.
  Official providers such as `openai` and `anthropic` may use custom base URLs,
  but they keep their official runtime adapters. Third-party OpenAI/Anthropic
  compatible services should use the dedicated `openai-compatible` and
  `anthropic-compatible` providers. Xiaomi MiMo has its own provider because it
  exposes both OpenAI-compatible and Anthropic-compatible API formats with
  provider-specific reasoning behavior.
- `providers/settings.ts` reads app options and normalizes configured provider
  configs.
- `providers/config.ts` builds the AI SDK provider registry with configured
  providers and proxy fetch.
- `providers/registry.ts` wires each provider id to a model catalog provider and
  a runtime adapter.

### Model Selection and Metadata

- `providers/modelResolver.ts` resolves model specifiers, task-specific model
  choices, model groups, and full runtime objects.
- `providers/models.ts` is the source of truth for model facts. Put
  model-specific context windows, modalities, tool support, image tool-result
  support, and reasoning metadata here as ordered rules. A rule `id` is only a
  stable maintenance/debug identifier; exact matching uses `modelIds`, family
  matching uses `patterns`, and curated provider lists are emitted only from
  explicit model ids. Reasoning
  metadata exposes one unified `levels` list for UI and runtime selection:
  `none`, `auto`, `minimal`, `low`, `medium`, `high`, and `xhigh`.
- `providers/metadata.ts` resolves ordered model rules for a provider/model pair
  and merges those facts with API-discovered or custom model capabilities.
- `providers/capabilities.ts` only builds capability objects from explicit data.
  It should not infer model behavior from model id strings.
- `providers/types.ts` contains provider/model contracts shared across the
  provider layer.

### Model Discovery

`providers/modelCatalog/` fetches or provides available models for each
provider. Catalog providers normalize provider API responses into
`AiSdkDiscoveredModel` values. The shared base class applies central model
metadata so dynamic API results, curated lists, and custom models behave
consistently.
Providers with OpenAI-compatible `/models` endpoints should use the shared
base helper instead of duplicating bearer-auth request and fallback parsing.

If a provider API returns real capability data, map it in the catalog provider.
If it only returns ids, add or update explicit model rules in
`providers/models.ts`.

### Runtime Adapters

`providers/runtimeAdapters/` translates app-level runtime preferences into
provider-specific AI SDK behavior:

- create the correct AI SDK provider wrapper;
- map reasoning settings to provider options;
- enable or disable provider-specific thinking modes;
- prepare or validate replayed messages when a provider requires reasoning
  content for tool calls.

Runtime adapters should not define general model facts. They should read
reasoning metadata through `getAiProviderModelReasoningMetadata`.
`openaiCompatible.ts` and `anthropicCompatible.ts` are the shared factories for
OpenAI-like and Anthropic-like APIs. Provider-specific runtime behavior belongs
in its own file, such as `openai.ts`, `anthropic.ts`, `mimo.ts`, `zhipu.ts`, or
`openrouter.ts`. Providers that expose multiple wire formats, such as MiniMax
or Xiaomi MiMo, should select between the shared compatible factories in
`providers/registry.ts` instead of keeping duplicate provider-specific
OpenAI/Anthropic adapter files.

`createBasicRuntimeAdapter` is only for providers where Legir has no
app-controlled reasoning mapping yet. A model may still reason internally, but
the app will not expose reasoning controls, replay policy, or provider options
until that provider gets an explicit adapter implementation.
OpenAI-compatible chat-only providers with custom reasoning behavior can share
`openAiCompatibleChat.ts` for the SDK wrapper and reasoning replay validation.

### Reasoning Levels

Reasoning support is model-based, not provider-default based:

- `providers/models.ts` declares whether a model supports reasoning, which
  select levels are valid, and optional `budgetTokensByLevel` mappings for
  providers that expose thinking as token budgets.
- `providers/metadata.ts` exposes `resolveAiProviderModelReasoning`, which
  returns the selectable levels, the clamped selected level, and whether a
  select should be shown.
- `providers/runtimeAdapters/shared.ts` normalizes the selected `level`, clamps
  unsupported levels, and maps budget levels to token counts.
- Runtime adapters translate the resolved level to provider-specific options
  such as OpenAI `reasoningEffort`, Google `thinkingConfig`, Anthropic
  `thinking.budgetTokens`, or provider thinking switches.

UI should use the resolved levels as the only reasoning control surface. If the
resolved model has no levels, or only one level, the UI should not show a
reasoning-level select.

## `tasks/`

`tasks/` implements one-shot AI workflows. These functions are not chat turns and
do not execute the chat tool registry. They should accept explicit `appOptions`
and a model specifier so callers and tests can control provider selection without
reading UI state.

- `translateText.ts` translates plain text.
- `translatePageBlocksStructured.ts` translates page text blocks with structure.
- `summarizeText.ts` summarizes text, including conversation-memory input.
- `summarizePageImages.ts` summarizes rendered page images with a vision model.
- `analyzePageForFields.ts` analyzes page images for form field candidates.
- `tasks/index.ts` exports task implementations.

Task implementations may use `resolveAiSdkRuntime` or
`resolveAiSdkLanguageModelDetailed`, but provider-specific request behavior
should stay in `providers/runtimeAdapters/`.

## Shared Entry Points and Helpers

- `index.ts` re-exports the supported public surface for the rest of the app.
- `taskRunner.ts` keeps legacy task-style entry points such as `translateText`,
  `analyzePageForFields`, and `summarizePageImages`; it bridges current editor
  options into task implementations.
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
3. `providers/registry.ts` selects the model catalog provider and runtime
   adapter.
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

- Add a new provider id in `providers/catalog.ts`.
- Wire the provider's model catalog and runtime adapter in
  `providers/registry.ts`.
- Add or correct model facts in `providers/models.ts`.
- Add provider request-shape behavior in `providers/runtimeAdapters/`.
- Add chat tools in `chat/tools/` and register them through
  `chat/aiToolRegistry.ts`.
- Add one-shot workflows in `tasks/`.
- Keep UI state and display logic outside this service layer except for the
  narrow bridges in `taskRunner.ts` and `editorState.ts`.
