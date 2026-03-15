# 右侧 AI 问答面板（AI Chat Panel）实现方案

## 目标

在 FormForge 编辑器右侧功能栏中新增一个 **AI 问答面板**，以聊天框形式提供“读文档 + 搜索 + 跳转 + 临时高亮”的能力。

目标体验：

- 用户可以像聊天一样提问，例如：
  - “总结这一页内容”
  - “搜索免责条款并跳过去”
  - “把所有包含签名的位置高亮出来”
- AI 不直接修改 PDF 内容，只通过工具读取文档和驱动界面动作。
- AI 能读取整页文本，不依赖用户手动复制。
- AI 工具接口采用 **MCP 风格** 的内部协议，但不实现真实 MCP server。

本方案只覆盖 **读操作 + 页面联动**，不包含 AI 创建/修改字段、批注、导出等写操作。

---

## 现状与可复用基础

当前代码里已经具备实现该功能的大部分底层能力：

- 右侧栏 dock 和 panel 容器
  - `src/components/properties-panel/RightPanelTabDock.tsx`
  - `src/components/properties-panel/PanelLayout.tsx`
  - `src/pages/EditorPage.tsx`
- 页面文本读取
  - `src/services/pdfService/pdfWorkerService.ts#getTextContent`
  - `src/workers/pdf-render.worker.ts`
- 文本搜索与命中定位
  - `src/lib/pdfSearch.ts#findPdfSearchResults`
  - `src/components/sidebar/PDFSearchPanel.tsx`
  - `src/components/workspace/lib/pdfSearchHighlights.ts`
- 页面滚动、结果聚焦、文本选区联动
  - `src/lib/eventBus.ts`
  - `src/components/workspace/Workspace.tsx`
  - `src/components/workspace/layers/PDFTextLayer.tsx`
- LLM provider 抽象
  - `src/services/LLMService/types.ts`
  - `src/services/LLMService/llmService.ts`
  - `src/services/LLMService/providers/openaiProvider.ts`
  - `src/services/LLMService/providers/geminiProvider.ts`

关键结论：

- 右侧入口和 panel 外壳可以直接复用。
- 文本读取和搜索已有稳定实现，不需要重新发明 PDF 解析链路。
- 当前 `translateService` 不适合作为 AI 问答主入口，因为它是“文本翻译 registry”，不是“多轮对话 + 工具调用”编排层。
- AI 问答应作为新的独立 capability 接入 `LLMService`。

---

## MVP 范围

### v1 必做

- 右侧栏新增 `ai_chat` tab。
- 聊天面板支持：
  - 消息列表
  - 输入框
  - 发送 / 停止
  - 模型选择
  - 工具调用过程展示
- AI 输出支持 **流式返回**（assistantMessage 增量更新），工具执行过程按调用顺序在时间线中展示。
- 标题栏支持：
  - 关闭按钮
  - 历史会话列表（popover）
  - 新对话按钮
- AI 可调用以下工具：
  - 读取文档上下文
  - 读取整页文本
  - 搜索全文
  - 跳转到页面
  - 聚焦某条搜索结果
  - 临时高亮一组搜索结果
  - 清空临时高亮
- 聊天记录在当前打开文档期间保留，切换文档后清空。
- 没有 PDF、没有模型、请求取消、搜索无结果时有明确状态。

### v1 不做

- AI 直接新增、删除、修改表单字段
- AI 直接新增、删除、修改批注
- AI 直接导出、保存、打印
- 真实 MCP server / 外部 tool server
- 多 Agent / 多会话并发执行（同一时刻仅允许一个会话处于 running）
- 联网搜索
- OCR 新链路

---

## 用户交互设计

## 1) 右侧入口

在 `RightPanelTabDock` 新增 tab：

- id: `ai_chat`
- title: `AI 问答`
- icon: `Bot` 或 `MessageSquare`

行为：

- 点击后打开右侧 AI 面板。
- 与现有 `document` / `properties` / `form_detect` / `page_translate` 一样走 `rightPanelTab`。
- 不复用当前 `translate` 浮窗逻辑。

## 2) 面板主体

新组件：`src/components/properties-panel/AiChatPanel.tsx`

建议沿用 `PanelLayout`，内部结构分三段：

- Header
  - 标题
  - 历史会话 popover 按钮（会话列表 + 清空当前会话）
  - 新对话按钮
  - 关闭按钮（与其他右侧面板一致）
- Body
  - **统一时间线（timeline）**：用户气泡、助手气泡、工具执行卡片按发生顺序混排
  - 空状态 / 错误状态
- Footer
  - 单行默认的自适应 `textarea`（Enter 发送、Shift+Enter 换行）
  - 模型选择（放在输入框下方）
  - 发送 / 停止按钮

## 3) 消息展示规则

消息类型：

- `user`
- `assistant`
- `tool`
- `system` 仅内部使用，不在 UI 中显示

展示规则：

- 用户消息正常显示。
- 助手消息支持流式输出，最终以自然语言答复结束。
- tool 以“工具执行记录”卡片形式展示，并与聊天气泡混排。
- tool 卡片至少展示：
  - 工具名
  - 入参摘要
  - 成功 / 失败状态
  - 结果摘要

## 4) 空状态

- 无 PDF：显示“未加载 PDF，AI 可在打开文档后读取内容”
- 无可用模型：显示“未配置可用的 OpenAI / Gemini Key”
- 首次进入：给出提示示例
  - “总结当前页”
  - “搜索签名并高亮”
  - “跳到包含免责条款的页面”

## 5) 会话与切文档行为

- 切换右侧 tab：保留当前聊天记录。
- 同一文档内切换页码：保留当前聊天记录。
- 支持同一文档内多会话（历史列表切换），会话仅在内存中保留，不持久化。
- 切换到新 PDF：重置以下内容：
  - 消息列表
  - tool 执行记录
  - 搜索结果索引
  - 临时高亮
  - 正在执行的请求

---

## 总体架构

建议新增一组专用模块：

```text
src/services/aiChat/
  types.ts
  aiChatService.ts
  documentContextService.ts
  aiToolRegistry.ts
  prompts.ts
```

以及一个 UI 控制 hook：

```text
src/hooks/useAiChatController.ts
```

职责划分如下。

## 1) `AiChatPanel`

只负责 UI 展示与事件发起，不直接操作 worker、事件总线、LLM provider。

输入：

- `state`
- `availableModels`
- `onSend`
- `onStop`
- `onClear`
- `onSelectModel`

输出：

- 用户输入文本
- 模型切换
- 停止当前请求

## 2) `useAiChatController`

这是 v1 的前端编排中心，挂在 `EditorPage.tsx`。

职责：

- 管理聊天消息状态
- 管理当前运行状态
- 持有搜索结果索引
- 持有临时高亮状态
- 调用 `aiChatService`
- 执行 tool 并把结果回填给模型
- 与 `Workspace` / `eventBus` 联动

放在 `EditorPage` 的原因：

- 它天然能访问当前文档状态、当前页、选中文本、滚动容器、右侧 panel 状态。
- `Workspace` 联动逻辑本来就在 `EditorPage` 和 `eventBus` 之间，放这里最顺手。
- 这些状态是当前文档级的，不适合做成全局持久 store。

## 3) `documentContextService`

职责：

- 从 `pdfWorkerService.getTextContent()` 构建 AI 可消费的上下文数据
- 统一封装“按页读取”“按页提取行块”“当前运行时上下文摘要”
- 做轻量缓存，避免同一页重复拼接文本

推荐能力：

- `getDocumentContext()`
- `readPages()`
- `searchDocument()`
- `clearCache()`

## 4) `aiToolRegistry`

职责：

- 注册可供 AI 调用的工具定义
- 统一管理：
  - 名称
  - 描述
  - 输入 schema
  - 执行函数
- 把工具执行结果规范化成统一结构返回给 `aiChatService`

## 5) `aiChatService`

职责：

- 对 provider 发送一轮对话请求
- 解析模型返回的：
  - 助手文本
  - tool 调用列表
- 驱动“模型 -> 工具 -> 模型”的循环，直到得到最终答复或达到上限

注意：

- v1 支持 `assistantMessage` 的流式增量更新（token delta），并在 UI 中实时更新助手气泡。
- tool 调用仍按顺序执行并在时间线中更新状态（running/done/error）。

## 6) `LLMService` 扩展

当前 `LLMService` 只有：

- `translate`
- `formDetect`

建议扩展为：

- `chatAgent`

不要把 AI 问答塞进 `translateService`，因为：

- translate 的输入输出是单段文本
- 没有对话历史
- 没有 tool loop
- 没有 system prompt / tool schema / structured result 协议

---

## 状态设计

聊天状态不持久化到 localStorage，不写入 `useEditorStore`。

原因：

- 历史对话和工具结果体积不稳定
- 可能包含用户文档内容
- 属于会话态，不应跨文档复用

建议在 `useAiChatController` 中维护如下状态：

```ts
type AiChatRunStatus = "idle" | "running" | "cancelling" | "error";

type AiChatTimelineItem =
  | {
      id: string;
      kind: "message";
      role: "user" | "assistant";
      text: string;
      createdAt: string;
      isStreaming?: boolean;
    }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      toolName: AiToolName;
      status: "running" | "done" | "error";
      argsText: string;
      resultSummary?: string;
      error?: string;
      createdAt: string;
    };

interface AiChatSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface AiSearchResultRecord {
  id: string;
  query: string;
  result: PDFSearchResult;
}

interface AiChatSessionState {
  runStatus: AiChatRunStatus;
  timeline: AiChatTimelineItem[];
  conversation: LLMChatMessage[]; // LLM 视角的消息历史（含 tool result）
  activeTurnId: string | null;
  title: string;
  updatedAt: string;
  searchResultsById: Map<string, AiSearchResultRecord>;
  highlightedResultIds: string[];
  lastError: string | null;
}

interface AiChatPanelState {
  selectedModelKey: string | null; // providerId:modelId
  activeSessionId: string;
  sessions: AiChatSessionSummary[];
}
```

运行期约束：

- 同一时刻只允许一个 active turn。
- 用户点击停止时中断：
  - provider 请求
  - `getTextContent`
  - 搜索任务
- 搜索结果索引和高亮状态属于当前文档 session，不跨文档保留。

---

## 文档上下文设计

## 1) 运行时文档上下文

AI 不应该在每轮默认收到整本 PDF 文本，否则成本高且容易超上下文。

默认只注入轻量上下文：

```ts
interface AiDocumentContext {
  filename: string;
  pageCount: number;
  currentPageNumber: number | null;
  visiblePageNumbers: number[];
  selectedText: string;
  outlinePreview: Array<{
    title: string;
    pageNumber?: number;
  }>;
}
```

构建来源：

- `filename`, `pages.length`, `currentPageIndex`, `outline` 来自 `EditorPage`
- `selectedText` 来自当前 DOM selection，仅在选区位于 PDF text layer 内时提供
- `visiblePageNumbers` 取当前页和可见页范围，v1 可先只给当前页

## 2) 按页文本读取

复用 `pdfWorkerService.getTextContent({ pageIndex })`。

按页读取结果建议统一成：

```ts
interface AiReadablePage {
  pageNumber: number;
  text: string;
  charCount: number;
  lineCount?: number;
  lines?: Array<{
    text: string;
    rect: { x: number; y: number; width: number; height: number };
  }>;
}
```

文本构建策略：

- `text`：按 `TextContent.items` 顺序直接拼接，和当前全文搜索逻辑保持一致
- `lines`：复用 `pageTranslationService.extractLinesFromTextLayer(...)`
- `includeLayout=false` 时只返回 `text`
- `includeLayout=true` 时同时返回 `lines`

## 3) 缓存策略

`documentContextService` 内部缓存两类数据：

- `pageTextCache: Map<number, string>`
- `pageLinesCache: Map<number, PageTranslationLine[]>`

清理时机：

- `state.pdfBytes` 变化
- `state.filename` 变化
- `state.pages.length` 变化

v1 不做持久缓存，只做当前文档内存缓存。

---

## 工具协议设计

本功能采用“内部 MCP 风格工具协议”。

原则：

- 工具名固定
- 参数严格 JSON schema
- 工具返回结构固定
- 模型不能直接操作 DOM，只能调用工具

### 通用约定

- 对 AI 暴露的页码统一使用 **`pageNumber`（从 1 开始）**
- 内部实现再转换为 `pageIndex`（从 0 开始）
- 所有搜索结果使用 `resultId` 作为后续操作主键
- 所有高亮都是 **临时 UI 高亮**，不写入 `annotations`

## 1) `get_document_context`

用途：

- 获取当前文档的轻量上下文摘要

输入：

```json
{}
```

输出：

```json
{
  "filename": "contract.pdf",
  "pageCount": 12,
  "currentPageNumber": 3,
  "visiblePageNumbers": [3],
  "selectedText": "免责条款",
  "outlinePreview": [
    { "title": "Section 1", "pageNumber": 1 },
    { "title": "Section 2", "pageNumber": 4 }
  ]
}
```

## 2) `read_pages`

用途：

- 读取一个或多个页面的全文
- 可选返回按行版面信息

输入：

```json
{
  "pageNumbers": [3],
  "includeLayout": false
}
```

约束：

- 一次最多 8 页
- `pageNumber` 必须在 `1..pageCount`

输出：

```json
{
  "pages": [
    {
      "pageNumber": 3,
      "text": "....",
      "charCount": 1024
    }
  ]
}
```

若 `includeLayout=true`：

```json
{
  "pages": [
    {
      "pageNumber": 3,
      "text": "....",
      "charCount": 1024,
      "lineCount": 18,
      "lines": [
        {
          "text": "免责条款如下",
          "rect": { "x": 92, "y": 188, "width": 160, "height": 18 }
        }
      ]
    }
  ]
}
```

## 3) `get_document_digest`

用途：

- 给整份文档或大页范围生成紧凑 digest
- 优先用于“总结全文”“概括多页内容”“先快速了解整本 PDF”

输入：

```json
{
  "startPage": 1,
  "endPage": 8,
  "charsPerChunk": 360,
  "sourceCharsPerChunk": 3600
}
```

说明：

- 必须传入连续页范围 `startPage` 和 `endPage`
- 每次调用只摘要这一个范围
- 做整文总结时应该拆成多个范围并自行组合结果

输出：

```json
{
  "pageCount": 42,
  "returnedPageCount": 8,
  "chunkCount": 1,
  "excerptCharsPerChunk": 360,
  "sourceCharsPerChunk": 3600,
  "chunks": [
    {
      "startPage": 1,
      "endPage": 8,
      "pageCount": 8,
      "charCount": 12430,
      "excerpt": "p1: ... p2: ... p3: ..."
    }
  ]
}
```

## 4) `search_document`

用途：

- 用当前全文搜索逻辑查找关键词

输入：

```json
{
  "query": "免责条款",
  "mode": "plain",
  "regexFlags": "",
  "pageNumbers": [1, 2, 3],
  "caseSensitive": false,
  "maxResults": 20
}
```

说明：

- `pageNumbers` 可省略，省略表示全文搜索
- `mode` 默认是 `plain`
- `mode="regex"` 时，`query` 按正则表达式解释
- `regexFlags` 可选，适合传 `m` / `s` 等附加标志；内部会自动补全全局匹配，并根据 `caseSensitive` 控制大小写
- 当关键词之间可能被空格、换行、OCR 噪声或标点打断时，优先考虑 regex，例如：`免责\\s*条款`
- `maxResults` 默认 20，最大 50

输出：

```json
{
  "query": "免责条款",
  "total": 3,
  "results": [
    {
      "resultId": "sr_12",
      "pageNumber": 2,
      "matchText": "免责条款",
      "snippet": "......免责条款......"
    }
  ]
}
```

实现要求：

- 内部复用 `findPdfSearchResults(...)`
- 每个结果生成 `resultId`
- 控制器把 `resultId -> PDFSearchResult` 存入 `searchResultsById`

## 5) `navigate_page`

用途：

- 滚动到页面顶部

输入：

```json
{
  "pageNumber": 5
}
```

输出：

```json
{
  "ok": true,
  "pageNumber": 5
}
```

实现：

- 发 `workspace:navigatePage`

## 6) `focus_result`

用途：

- 聚焦某个搜索结果

输入：

```json
{
  "resultId": "sr_12"
}
```

输出：

```json
{
  "ok": true,
  "resultId": "sr_12",
  "pageNumber": 2
}
```

实现：

- 从 `searchResultsById` 找到对应 `PDFSearchResult`
- 发 `workspace:focusSearchResult`

注意：

- 只滚动和视觉聚焦，不修改用户当前 selection

## 7) `highlight_results`

用途：

- 把若干搜索结果做成临时高亮

输入：

```json
{
  "resultIds": ["sr_12", "sr_13"]
}
```

输出：

```json
{
  "ok": true,
  "highlightedCount": 2
}
```

实现：

- 更新控制器内的 `highlightedResultIds`
- 重新组装 `highlightResultsByPage`
- 通过 `Workspace` 的文本层 overlay 展示

约束：

- 不创建 `Annotation`
- 不进入 undo/redo
- 不写入导出结果

## 8) `clear_highlights`

用途：

- 清空 AI 临时高亮

输入：

```json
{}
```

输出：

```json
{
  "ok": true
}
```

---

## Provider 能力扩展

## 1) 类型扩展

建议扩展 `src/services/LLMService/types.ts`：

```ts
export type LLMFunctionKind = "translate" | "formDetect" | "chatAgent";

export interface LLMChatToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface LLMChatToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface LLMChatTurnResult {
  assistantMessage: string;
  toolCalls: LLMChatToolCall[];
  finishReason: "stop" | "tool_calls";
}

export interface LLMChatAgentFunction {
  kind: "chatAgent";
  getModels: () => LLMModelOption[];
  refreshModels?: () => Promise<void>;
  runTurn: (input: {
    modelId?: string;
    messages: LLMChatMessage[];
    tools: LLMChatToolDefinition[];
    signal?: AbortSignal;
  }) => Promise<LLMChatTurnResult>;
}
```

## 2) Provider 实现策略

OpenAI / Gemini provider 都先采用 **结构化 JSON 输出**，不要在 v1 直接依赖官方原生 tool calling。

原因：

- 当前项目里两家 provider 都已经有“输出 JSON”的实现经验
- 前端一致性更强
- 便于统一调试和兜底

期望 provider 返回结构：

```json
{
  "assistantMessage": "我先帮你搜索免责条款。",
  "toolCalls": [
    {
      "id": "call_1",
      "name": "search_document",
      "argumentsJson": "{\"query\":\"免责条款\"}"
    }
  ],
  "finishReason": "tool_calls"
}
```

## 3) 模型选择

v1 模型列表来源：

- `chatAgent.getModels()`
- 如果 provider 暂时没有独立 chat model 列表，允许先复用当前文字模型列表

v1 不新增单独的设置页字段，直接复用现有 provider API Key 配置。

---

## Prompt 与 Tool Loop 设计

## 1) system prompt 核心约束

建议新增 `src/services/aiChat/prompts.ts`。

system prompt 应明确约束：

- 你正在一个 PDF 编辑器中协助用户
- 回答前优先使用工具读取文档，而不是猜测
- 不能声称“看到了页面”除非调用过工具
- 若用户要求搜索、跳转、高亮，应调用对应工具
- 不能捏造不存在的页码和结果
- 不能修改文档，只能读取与导航

## 2) tool loop

`aiChatService` 的执行流程固定如下：

1. 组装 `messages + tools`
2. 调用 provider `runTurn`
3. 若返回 `toolCalls.length > 0`
   - 逐个执行 tool
   - 把 tool 结果写回消息历史
   - 再发下一轮
4. 若返回 `finishReason === "stop"`
   - 落最终 assistant 消息
5. 超过最大轮次则终止并报错

固定约束：

- 最大 tool loop：10 轮（每轮模型可返回多个 toolCalls，按顺序执行）
- 同一轮 tool 按顺序执行，不并发
- 任一 tool 失败时，把错误以 tool result 形式回填模型，由模型决定是否继续或向用户解释

### 常见失败模式与修复

1. 模型在多次工具调用后直接结束（但没有给出最终回答）
   - 现象：工具卡片执行完，assistant 最终消息为空，UI 看起来“结束了”但没有答案。
   - 处理：tool loop 里做一次性兜底 finalization:
     - 若 `finishReason === "stop"` 且 `assistantMessage` 为空，则追加一条内部 system 指令，要求“基于上方工具结果输出最终回答，不再调用工具”，并再跑一轮。
     - 注意：该内部 system 指令只能用于本次 tool loop，不应持久化进后续对话上下文（否则会导致之后的轮次不再调用工具）。

2. 用户回复“继续”但上下文丢失
   - 根因通常是：工具已执行，但工具结果没有写回会话 `conversation`，或者 tool loop 报错/被取消时没有把“已执行部分”同步进会话。
   - 处理：
     - 每次 tool 执行结束，都应把 tool 的 `name + arguments + result` 写回对话历史（推荐 `TOOL_RESULT` block），这样模型在下一轮和下一次用户发言时都能“看见”它。
     - 当 tool loop 因为超出最大轮次/异常中断/用户 stop 结束时，要把 best-effort 的 `conversation` 保存到 session 中，保证下一次用户输入仍带着上下文继续。

---

## Workspace 联动设计

## 1) 跳转

以下动作继续复用现有 `eventBus`：

- `navigate_page` -> `workspace:navigatePage`
- `focus_result` -> `workspace:focusSearchResult`

不新增重复事件。

## 2) 临时高亮

AI 高亮不要占用左侧搜索面板状态。

实现方式：

- 在 `useAiChatController` 内维护 `highlightedResultIds`
- 从 `searchResultsById` 组装 `aiHighlightResultsByPage: Map<number, PDFSearchResult[]>`
- 在 `EditorPage` 渲染 `Workspace` 前，把：
  - 左侧搜索结果 `pdfSearchResultsByPage`
  - AI 临时高亮 `aiHighlightResultsByPage`
    合并成最终传给 `Workspace` 的结果映射

合并规则：

- manual search 和 AI highlight 都使用 `PDFSearchResult`
- id 互不冲突
- `activePdfSearchResultId` 只作用于左侧搜索，不作用于 AI 高亮

这样做的好处：

- `PDFTextLayer` 现有的高亮绘制逻辑可以直接复用
- 不需要新增第二套 overlay 系统
- 不会污染左侧搜索 query / loading / active result 状态

## 3) 当前选中文本

`get_document_context` 中的 `selectedText` 只在满足以下条件时返回：

- 当前 DOM selection 非空
- selection 位于 PDF text layer 内

这样 AI 可以理解用户的“这段文字”指令，但不需要额外暴露单独工具。

---

## 文件改动建议

建议新增文件：

- `docs/AI_CHAT_PANEL_PLAN.md`
- `src/components/properties-panel/AiChatPanel.tsx`
- `src/hooks/useAiChatController.ts`
- `src/services/aiChat/types.ts`
- `src/services/aiChat/prompts.ts`
- `src/services/aiChat/documentContextService.ts`
- `src/services/aiChat/aiToolRegistry.ts`
- `src/services/aiChat/aiChatService.ts`

建议修改文件：

- `src/pages/EditorPage.tsx`
- `src/components/properties-panel/RightPanelTabDock.tsx`
- `src/services/LLMService/types.ts`
- `src/services/LLMService/providers/openaiProvider.ts`
- `src/services/LLMService/providers/geminiProvider.ts`
- `src/services/LLMService/index.ts`
- `src/locales/zh-CN.ts`
- `src/locales/en.ts`
- 其他已启用语言包

可选修改文件：

- `src/components/ModelSelect.tsx`
  - 若聊天模型分组展示需要额外 hint
- `src/components/workspace/layers/PDFTextLayer.tsx`
  - 若最终合并映射后仍需区分 AI 高亮样式

---

## 详细落地步骤

## Phase 1：面板壳子与状态接入

- 新增 `ai_chat` tab
- 新增 `AiChatPanel`
- 在 `EditorPage` 中挂接 `useAiChatController`
- 支持：
  - 空状态
  - 输入
  - 消息列表
  - 停止
  - 清空会话

交付标准：

- 右侧可以切到 AI 面板
- 发送按钮能创建 user message
- 无模型 / 无文档状态正确

## Phase 2：文档上下文与工具层

- 实现 `documentContextService`
- 实现 `aiToolRegistry`
- 跑通以下工具：
  - `get_document_context`
  - `get_document_digest`
  - `read_pages`
  - `search_document`
  - `navigate_page`
  - `focus_result`
  - `highlight_results`
  - `clear_highlights`

交付标准：

- 本地 mock 执行工具可得到正确结构
- 搜索结果能复用现有 `findPdfSearchResults`
- 高亮不写入 annotation

## Phase 3：Provider chatAgent 能力

- 扩展 `LLMService` 类型
- 给 OpenAI / Gemini provider 增加 `chatAgent`
- 用 JSON schema 输出一轮结果

交付标准：

- 给定 messages + tools，provider 能返回：
  - assistant 文本
  - toolCalls

## Phase 4：tool loop 编排

- 实现 `aiChatService`
- 完成“模型 -> 工具 -> 模型”循环
- 完成取消、中断、错误回填

交付标准：

- 能处理“先搜索，再总结，再跳转”的多步任务
- 用户点击停止能中断整轮执行

## Phase 5：UI 打磨与验收

- tool 调用记录 UI
- 文案与 i18n
- 无结果 / 错误状态
- 清理文档切换行为

---

## 边界与失败模式

## 1) 无文档

- 不允许执行 `read_pages` / `search_document`
- tool 返回结构化错误：

```json
{
  "ok": false,
  "error": "NO_DOCUMENT"
}
```

## 2) 无可用 provider

- 面板禁用发送
- 若强行触发请求，控制器直接返回 UI 错误，不进入 tool loop

## 3) 搜索无结果

- `search_document` 返回：

```json
{
  "query": "签名",
  "total": 0,
  "results": []
}
```

- 由模型决定是提示用户“未找到”，还是建议更换关键词

## 4) resultId 失效

- 例如用户切文档后旧结果无效
- `focus_result` / `highlight_results` 返回：

```json
{
  "ok": false,
  "error": "RESULT_NOT_FOUND"
}
```

## 5) 请求取消

- 用户点击停止后：
  - `AbortController.abort()`
  - 当前 provider 请求中止
  - 当前 tool 执行中止
  - runStatus 回到 `idle`
  - 消息列表保留已完成内容

## 6) 长文档

v1 不做整本文本预加载。

策略：

- 默认只给文档摘要上下文
- 全文/多页任务优先调用 `get_document_digest`
- 由模型按需调用 `read_pages`
- 一次最多读取 5 页
- digest 覆盖整份文档，但只返回压缩后的 chunk 摘录，避免主上下文膨胀

---

## 验收场景

以下场景全部通过即视为 v1 可用。

## 1) 当前页总结

用户输入：

- “总结当前页内容”

预期：

- AI 调用 `get_document_context`
- AI 调用 `read_pages([currentPage])`
- 返回摘要

## 2) 整份文档总结

用户输入：

- “总结整个文档”

预期：

- AI 调用 `get_document_context`
- AI 调用 `get_document_digest`
- 如 digest 不足，再按需调用 `read_pages`
- 最终回答覆盖整份文档，而不是只停在前几页

## 3) 全文搜索并跳转

用户输入：

- “搜索免责条款并跳过去”

预期：

- AI 调用 `search_document`
- AI 调用 `focus_result`
- 视口滚动到命中处
- 回答里说明命中页码

## 4) 搜索并高亮多处结果

用户输入：

- “把所有包含签名的位置高亮出来”

预期：

- AI 调用 `search_document`
- AI 调用 `highlight_results`
- 页面上出现临时高亮
- 不生成 annotation

## 5) 连续追问

用户输入：

- “第一个结果上下文是什么？”

预期：

- AI 复用当前 session 中的 `resultId`
- 必要时再调用 `read_pages`
- 不要求用户重新搜索

## 6) 切文档

预期：

- AI 会话重置
- 高亮清空
- 旧 `resultId` 失效

---

## 默认决策

以下决策在 v1 中固定，不再留给实现阶段临时判断：

- AI 问答作为新的右侧 tab：`ai_chat`
- 聊天记录不持久化，不写 `useEditorStore`
- 页码对 AI 一律使用 1-based `pageNumber`
- 工具接口采用内部 MCP 风格，不实现真实 MCP server
- provider v1 先用结构化 JSON 输出，不直接依赖原生 tool calling
- 临时高亮复用现有 `PDFSearchResult` 和 text layer 高亮渲染
- 高亮不写 annotation，不进入 undo/redo，不参与导出
- 文档切换时清空会话和高亮

---

## 后续扩展方向

v1 稳定后，可继续扩展：

- `read_selection` / `read_visible_pages`
- `open_outline_item`
- `select_search_text`
- 让 AI 读取注释和字段树
- 让 AI 触发只读型批量分析，例如：
  - “列出所有必填字段”
  - “找出所有链接批注”
- 再下一阶段才考虑写操作工具：
  - 添加高亮批注
  - 添加评论
  - 新建字段
