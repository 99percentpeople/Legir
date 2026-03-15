# AI SDK 迁移清单

本文档用于指导 FormForge 当前 AI 调用层迁移到统一的 AI SDK 架构。

目标不是一次性重写整个 AI 面板，而是分阶段把底层调用、工具定义、provider 管理和流式事件统一到 AI SDK 上，同时尽量保持现有 UI、持久化和工具能力不回退。

## 目标

- 使用 `zod` 作为 AI 工具参数的唯一 schema 真源
- 使用 AI SDK Core 统一聊天、流式输出、工具调用、结构化输出
- 使用统一 provider registry 管理 OpenAI、Gemini 和 OpenAI 兼容接口
- 保留现有右侧 AI 面板、时间线、thinking 卡片、工具卡片、会话持久化
- 逐步删除当前手写 provider chat/summarize 逻辑，避免长期维护两套实现

## 非目标

- 本次迁移不要求把 UI 改成 AI SDK UI
- 本次迁移不要求立刻重写 `formDetect` 图像识别逻辑
- 本次迁移不要求一次性删除所有旧代码，允许阶段性双跑和灰度切换

## 当前状态

当前 AI 相关实现主要分布在以下文件：

- `src/services/LLMService/index.ts`
- `src/services/LLMService/llmService.ts`
- `src/services/LLMService/providers/openaiProvider.ts`
- `src/services/LLMService/providers/geminiProvider.ts`
- `src/services/LLMService/types.ts`
- `src/services/LLMService/toolSchema.ts`
- `src/services/aiChat/aiChatService.ts`
- `src/services/aiChat/aiToolRegistry.ts`
- `src/services/aiChat/documentContextService.ts`
- `src/services/aiChat/prompts.ts`
- `src/hooks/useAiChatController.ts`

当前已经完成的有利条件：

- AI 工具 schema 已切到 `zod`
- 工具协议已从 `args_json` 改成结构化 `args`
- AI 工具读写分类已经存在
- 现有 controller 已有自定义时间线和持久化能力

这意味着迁移重点已经不再是“修协议”，而是“替换底层执行引擎”。

## 目标架构

建议新增一层 `src/services/aiSdk/`，作为未来统一入口：

```text
src/services/aiSdk/
  providers.ts
  modelRegistry.ts
  shared/
    toolToJsonSchema.ts
    streamParts.ts
  tools/
    documentTools.ts
    annotationTools.ts
    formTools.ts
    navigationTools.ts
  agents/
    chatAgent.ts
  tasks/
    summarizeText.ts
    summarizeDocument.ts
    generateSessionTitle.ts
```

推荐职责划分：

- `providers.ts`
  负责创建 AI SDK provider registry
- `modelRegistry.ts`
  负责把现有 UI 模型配置映射成 AI SDK model id
- `tools/*`
  负责把现有 `zod` schema + execute 封装成 AI SDK `tool(...)`
- `agents/chatAgent.ts`
  负责 `streamText(...)`、多步工具循环、流式事件映射
- `tasks/*`
  负责 `generateText(...)` / `generateObject(...)`

## 依赖迁移

第一步引入以下包：

- `ai`
- `@ai-sdk/openai`
- `@ai-sdk/google`
- `@ai-sdk/openai-compatible`

如果阶段一只想先做总结能力，也可以先只引入：

- `ai`
- `@ai-sdk/openai`
- `@ai-sdk/google`

## 迁移顺序

### Phase 0：冻结现有协议

目的：在继续迁移前，避免旧协议继续膨胀。

清单：

- 保持 `zod` 作为工具 schema 唯一真源
- 不再给当前手写 provider 增加新的 JSON 协议分支
- 不再新增新的 `args` 兼容格式
- 所有新工具继续写在 `src/services/aiChat/aiToolRegistry.ts`

验收标准：

- 所有 AI 工具都使用 `zod` schema
- 当前 `lint` / `build` 通过

### Phase 1：接入 AI SDK Provider 层

目的：先统一 provider 创建方式，但不立即替换现有 chat agent。

新增文件：

- `src/services/aiSdk/providers.ts`
- `src/services/aiSdk/modelRegistry.ts`

清单：

- 创建 OpenAI provider
- 创建 Gemini provider
- 创建 OpenAI-compatible provider，用于 DeepSeek 等兼容接口
- 把当前 store 中的 provider 配置读取逻辑搬到新层
- 提供统一的 `getLanguageModel(providerId, modelId)` 方法

注意点：

- `DeepSeek` 不要再尝试 `/responses`，统一走 OpenAI-compatible provider
- 自定义 base URL 走 provider 构造参数，不要散落在业务层判断

验收标准：

- 可以在不影响现有 UI 的前提下，通过新层拿到 model 实例
- 现有模型列表展示行为不变

### Phase 2：先迁移 summarize 任务

目的：用低风险任务验证 AI SDK 调用链。

优先迁移：

- `summarizeText`
- `get_document_digest` 的 AI summary 模式
- 会话标题生成

新增文件：

- `src/services/aiSdk/tasks/summarizeText.ts`
- `src/services/aiSdk/tasks/summarizeDocument.ts`
- `src/services/aiSdk/tasks/generateSessionTitle.ts`

替换点：

- `src/services/LLMService/index.ts` 的 `summarizeText(...)`
- `src/hooks/useAiChatController.ts` 中摘要模型调用入口

实现建议：

- 文本摘要使用 `generateText(...)`
- 需要结构化结果的任务使用 `generateObject(...)`
- 先不要引入工具调用

验收标准：

- `get_document_digest` 仅在已配置摘要模型时可用
- 摘要输出质量不回退
- 不再依赖 `openaiProvider.ts` / `geminiProvider.ts` 中的 summarize 实现

### Phase 3：迁移 chat agent 到 AI SDK

目的：替换当前最重的手写 tool loop。

新增文件：

- `src/services/aiSdk/agents/chatAgent.ts`
- `src/services/aiSdk/shared/streamParts.ts`

替换点：

- `src/services/aiChat/aiChatService.ts`
- `src/services/LLMService/index.ts` 中 `runChatAgentTurn(...)`
- `src/services/LLMService/index.ts` 中 `runChatAgentTurnStream(...)`

实现建议：

- 使用 `streamText(...)`
- 使用 AI SDK tool calling，不再让模型手写整段工具循环协议
- 使用 `stopWhen(...)` 控制最大步数
- 把 `fullStream` 事件映射成现有 UI 能理解的时间线事件

要映射的 UI 事件至少包括：

- thinking delta
- assistant text delta
- tool start
- tool result
- error
- final text

注意点：

- 不要直接重写 `useAiChatController`，先通过 adapter 接上现有 timeline
- thinking 事件是否可用取决于 provider/model，要保留“无 thinking 通道”的退化路径
- 现有“直接 UI 动作完成后停止”的逻辑要保留

验收标准：

- 用户搜索、跳页、高亮、填表、读取注释功能可用
- 工具可多步调用
- thinking / 正文 / 工具卡片仍按现有 UI 展示
- `aiChatService.ts` 可以退役或只保留薄封装

### Phase 4：迁移工具定义到 AI SDK Tool

目的：彻底消除“registry 定义”和“模型工具定义”之间的中间转换层。

新增文件：

- `src/services/aiSdk/tools/documentTools.ts`
- `src/services/aiSdk/tools/annotationTools.ts`
- `src/services/aiSdk/tools/formTools.ts`
- `src/services/aiSdk/tools/navigationTools.ts`

迁移来源：

- `src/services/aiChat/aiToolRegistry.ts`

实现建议：

- 每个工具直接使用 `tool({ description, inputSchema, execute })`
- 仍然复用现有 `documentContextService`
- 读工具与写工具的分组信息继续保留在元数据层，不丢给模型协议自己猜

建议拆分：

- 文档读取类
  - `get_document_context`
  - `get_document_metadata`
  - `get_document_digest`
  - `read_pages`
  - `search_document`
- 注释类
  - `list_annotations`
  - `highlight_results`
  - `clear_highlights`
- 表单类
  - `list_form_fields`
  - `fill_form_fields`
  - `focus_field`
- 导航类
  - `navigate_page`
  - `focus_result`

验收标准：

- `aiToolRegistry.ts` 中不再承担主要 schema/execute 注册职责
- AI SDK tools 成为新主入口

### Phase 5：统一模型注册和 UI 取数

目的：让 UI 不再依赖旧 LLMService registry。

替换点：

- `src/hooks/useAiChatController.ts`
- `src/services/LLMService/index.ts`

清单：

- 新建 AI SDK 模型分组查询方法
- 替换 `getChatModelGroups()`
- 替换 `subscribeLLMModelRegistry()`
- 保留现有模型选择 UI，不改交互

验收标准：

- 模型选择框数据完全来自新 registry
- 模型持久化逻辑不变
- 不再依赖旧 provider 自己维护的 model cache

### Phase 6：删除旧实现

目的：清理双轨逻辑。

可以删除或瘦身的文件：

- `src/services/LLMService/providers/openaiProvider.ts`
- `src/services/LLMService/providers/geminiProvider.ts`
- `src/services/LLMService/streamingJson.ts`
- `src/services/aiChat/aiChatService.ts`

可能保留的文件：

- `src/services/aiChat/documentContextService.ts`
- `src/services/aiChat/types.ts`
- `src/hooks/useAiChatController.ts`

保留原则：

- 文档上下文、注释、表单、导航等业务能力可以保留
- provider/chat loop/structured output 这类基础设施应迁出或删除

验收标准：

- 不再有两套聊天/摘要实现并存
- 旧 provider 文件不再承载业务逻辑

## 文件级改造清单

### 需要新增

- `src/services/aiSdk/providers.ts`
- `src/services/aiSdk/modelRegistry.ts`
- `src/services/aiSdk/shared/streamParts.ts`
- `src/services/aiSdk/tools/documentTools.ts`
- `src/services/aiSdk/tools/annotationTools.ts`
- `src/services/aiSdk/tools/formTools.ts`
- `src/services/aiSdk/tools/navigationTools.ts`
- `src/services/aiSdk/agents/chatAgent.ts`
- `src/services/aiSdk/tasks/summarizeText.ts`
- `src/services/aiSdk/tasks/summarizeDocument.ts`
- `src/services/aiSdk/tasks/generateSessionTitle.ts`

### 需要逐步替换

- `src/services/LLMService/index.ts`
- `src/hooks/useAiChatController.ts`
- `src/services/aiChat/aiToolRegistry.ts`
- `src/services/aiChat/prompts.ts`

### 需要最终删除或退役

- `src/services/LLMService/providers/openaiProvider.ts`
- `src/services/LLMService/providers/geminiProvider.ts`
- `src/services/LLMService/streamingJson.ts`
- `src/services/aiChat/aiChatService.ts`

## 风险点

### 1. thinking 通道差异

不同 provider 的 reasoning / thinking 事件结构不同。迁移到 AI SDK 后，仍需确认：

- OpenAI reasoning 模型是否能稳定暴露 reasoning stream
- Gemini 是否有可映射的 reasoning 事件
- DeepSeek 兼容接口是否只能提供普通文本流

处理原则：

- thinking 是增强能力，不应成为主流程强依赖
- 没有 reasoning 时，正文和工具链路必须仍然正常

### 2. 工具调用完成条件

当前有一套“直接 UI 动作成功后立即停止”的业务规则。迁移后不能只依赖模型自然停止，仍需要业务层兜底。

需要保留的场景：

- `navigate_page`
- `focus_result`
- `focus_field`
- `highlight_results`
- `clear_highlights`

### 3. 工具结果持久化

当前“继续”能力依赖把工具结果写回 conversation。迁移后也必须保留，不然工具多轮中断后会丢上下文。

### 4. 模型分组和配置来源

你当前模型列表和 API Key/base URL 配置散在 store 与旧 provider 文件里。迁移时如果不先收口，后面会出现 AI SDK registry 和 UI registry 双维护。

## 建议的落地顺序

建议按下面顺序推进：

1. 新增 AI SDK provider 层
2. 先迁 summarize
3. 再迁 chat agent
4. 再迁 tools
5. 再迁 model registry
6. 最后删旧实现

不要倒过来从 UI 开始改，也不要先改 `useChat`。

## 每阶段完成后的验证清单

每完成一个阶段都执行：

- `bun run lint`
- `bun run build`
- 手动验证 AI 面板发送消息
- 手动验证工具调用卡片顺序
- 手动验证中断后继续
- 手动验证模型切换与持久化

### 重点回归场景

- 问答并搜索文档
- 跳转到指定页面
- 高亮单个结果
- 高亮起止范围
- 读取注释
- 填写表单
- 总结整份文档
- 长对话后继续

## 迁移完成判定

满足以下条件即可认为迁移完成：

- 聊天和摘要都经由 AI SDK 发起
- 工具调用走 AI SDK tool calling
- provider 统一由 AI SDK registry 管理
- 当前 AI 面板 UI 无功能回退
- 删除旧 provider chat/summarize 逻辑后，功能仍完整

## 备注

建议在真正开始 Phase 3 之前，先补一个小型 adapter 层，把 AI SDK `fullStream` 事件转换成当前 UI 使用的内部事件格式。这样可以最大化复用 `useAiChatController.ts`，把风险控制在调用层，而不是把状态管理也一起重写。
