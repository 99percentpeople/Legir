import type { LandingCopy } from "./types";

export const zhCN: LandingCopy = {
  nav: {
    features: "功能",
    workflow: "如何使用",
    faq: "常见问题",
    menu: "打开导航",
    close: "关闭导航",
    skip: "跳至正文",
    home: "Legir 首页",
  },
  hero: {
    eyebrow: "你的文档，你的专注空间",
    title: "少一点纷扰，",
    accent: "多一份专注。",
    description:
      "一个安静、顺手的 PDF 工作台。阅读、批注、填写表单，让想法自然发生，让文件留在自己的设备上。",
    cta: "打开 Legir",
    source: "在 GitHub 查看",
    note: "浏览器直接使用 · 本地优先 · 开源",
  },
  preview: {
    label: "Legir 工作台交互演示",
    modes: {
      read: "阅读",
      annotate: "批注",
      forms: "表单",
      ai: "AI 助手",
      translate: "划词翻译",
    },
    caption:
      "可操作的界面演示，非完整编辑器。输入仅保留在内存中；AI 与翻译使用本地预设，不发送内容。处理自己的 PDF 请打开 Legir。",
    appLabel: "打开 Legir",
  },
  features: {
    eyebrow: "少些打断，多些投入",
    title: "从读懂一页，到完成一份。",
    description: "把需要的工具放在顺手的位置，让注意力回到文档本身。",
    items: [
      {
        title: "找回阅读的节奏。",
        description:
          "用缩略图、目录和搜索快速定位。从最近文档继续，把时间花在真正重要的内容上。",
      },
      {
        title: "让每个想法，有处可落。",
        description:
          "高亮一句话，留下一条批注，或在页边随手画下灵感。让思考和原文待在一起。",
      },
      {
        title: "表单不必，再绕一圈。",
        description:
          "填写或创建文本框、复选框等表单控件。完成后导出为 PDF，接着推进下一件事。",
      },
      {
        title: "需要时，多一个思考角度。",
        description:
          "按需启用 AI，辅助理解文档。自行选择服务商，在应用设置中配置 API Key。",
      },
    ],
    tags: [
      "专注的阅读空间",
      "高亮 · 批注 · 手绘",
      "填写 · 创建 · 导出",
      "服务由你选，是否启用由你定",
    ],
  },
  privacy: {
    eyebrow: "本地优先，从设计开始",
    title: "你的文件，\n始终由你掌握。",
    description:
      "阅读、批注和表单编辑都在你的设备上进行。日常处理 PDF，不必先把文件上传到服务器。",
    detail:
      "AI 是可选能力。使用 AI 或翻译服务时，相关内容会发送至你配置的服务商。",
    badge: "本地工作，不以云端为前提",
  },
  workflow: {
    eyebrow: "让流程，简单一点",
    title: "打开，投入，然后继续。",
    steps: [
      {
        title: "带上一份文档",
        description: "进入浏览器应用，打开设备上的 PDF 文件。",
      },
      {
        title: "按自己的方式处理",
        description: "阅读、添加批注、填写表单，或使用已配置的 AI 辅助理解。",
      },
      {
        title: "带着成果继续",
        description: "将处理后的文档导出为 PDF，交给下一段工作。",
      },
    ],
  },
  faq: {
    title: "开始之前，你可能还想知道。",
    items: [
      {
        title: "需要上传我的 PDF 吗？",
        description:
          "不需要。核心阅读、批注和表单操作在本地处理文档。只有主动使用可选的 AI 或翻译服务时，相关内容才会发送到你配置的服务商。",
      },
      {
        title: "不配置 AI，也能使用吗？",
        description:
          "当然。AI 是可选能力。不配置服务商或 API Key，也可以阅读、导航、批注和处理 PDF 表单。",
      },
      {
        title: "可以在哪些平台使用？",
        description:
          "可直接在浏览器中打开 Web 应用。项目也提供 Tauri 桌面应用，源码和构建说明可在 GitHub 查看，采用 AGPL-3.0-or-later 许可证。",
      },
    ],
  },
  closing: {
    title: "下一个好想法，从这一页开始。",
    description: "留一点时间，打开一份 PDF。其余的，交给专注。",
  },
  footer: {
    tagline: "给文档，也给思考，一点空间。",
    license: "开源 · AGPL-3.0-or-later",
  },
};
