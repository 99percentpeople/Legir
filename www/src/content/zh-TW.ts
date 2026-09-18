import type { LandingCopy } from "./types";

export const zhTW: LandingCopy = {
  nav: {
    features: "功能",
    workflow: "如何使用",
    faq: "常見問題",
    menu: "開啟導覽",
    close: "關閉導覽",
    skip: "跳至正文",
    home: "Legir 首頁",
  },
  hero: {
    eyebrow: "你的文件，你的專注空間",
    title: "少一點紛擾，",
    accent: "多一份專注。",
    description:
      "一個安靜、順手的 PDF 工作空間。閱讀、註解、填寫表單，讓想法自然發生，讓檔案留在自己的裝置上。",
    cta: "開啟 Legir",
    source: "在 GitHub 查看",
    note: "瀏覽器直接使用 · 本機優先 · 開源",
  },
  preview: {
    label: "Legir 工作台互動示範",
    modes: {
      read: "閱讀",
      annotate: "註解",
      forms: "表單",
      ai: "AI 助理",
      translate: "選取翻譯",
    },
    caption:
      "可操作的介面示範，非完整編輯器。輸入僅保留在記憶體；AI 與翻譯使用本機預設，不傳送內容。處理自己的 PDF 請開啟 Legir。",
    appLabel: "開啟 Legir",
  },
  features: {
    eyebrow: "少些打斷，多些投入",
    title: "從讀懂一頁，到完成一份。",
    description: "把需要的工具放在順手的位置，讓注意力回到文件本身。",
    items: [
      {
        title: "找回閱讀的節奏。",
        description:
          "用縮圖、目錄和搜尋快速定位。從最近文件繼續，把時間花在真正重要的內容上。",
      },
      {
        title: "讓每個想法，有處可落。",
        description:
          "螢光標記一句話，留下一則註解，或在頁邊隨手畫下靈感。讓思考和原文待在一起。",
      },
      {
        title: "表單不必，再繞一圈。",
        description:
          "填寫或建立文字欄位、核取方塊等表單控制項。完成後匯出為 PDF，接著推進下一件事。",
      },
      {
        title: "需要時，多一個思考角度。",
        description:
          "按需啟用 AI，輔助理解文件。自行選擇服務商，在應用程式設定中配置 API Key。",
      },
    ],
    tags: [
      "專注的閱讀空間",
      "螢光標記 · 註解 · 手繪",
      "填寫 · 建立 · 匯出",
      "服務由你選，是否啟用由你定",
    ],
  },
  privacy: {
    eyebrow: "本機優先，從設計開始",
    title: "你的檔案，\n始終由你掌握。",
    description:
      "閱讀、註解和表單編輯都在你的裝置上進行。日常處理 PDF，不必先把檔案上傳到伺服器。",
    detail:
      "AI 是選用功能。使用 AI 或翻譯服務時，相關內容會傳送至你設定的服務商。",
    badge: "本機工作，不以雲端為前提",
  },
  workflow: {
    eyebrow: "讓流程，簡單一點",
    title: "開啟，投入，然後繼續。",
    steps: [
      {
        title: "帶上一份文件",
        description: "進入瀏覽器應用程式，開啟裝置上的 PDF 檔案。",
      },
      {
        title: "按自己的方式處理",
        description: "閱讀、新增註解、填寫表單，或使用已設定的 AI 輔助理解。",
      },
      {
        title: "帶著成果繼續",
        description: "將處理後的文件匯出為 PDF，交給下一段工作。",
      },
    ],
  },
  faq: {
    title: "開始之前，你可能還想知道。",
    items: [
      {
        title: "需要上傳我的 PDF 嗎？",
        description:
          "不需要。核心閱讀、註解和表單操作在本機處理文件。只有主動使用選用的 AI 或翻譯服務時，相關內容才會傳送到你設定的服務商。",
      },
      {
        title: "不設定 AI，也能使用嗎？",
        description:
          "當然。AI 是選用功能。不設定服務商或 API Key，也可以閱讀、導覽、註解和處理 PDF 表單。",
      },
      {
        title: "可以在哪些平台使用？",
        description:
          "可直接在瀏覽器中開啟 Web 應用程式。專案也提供 Tauri 桌面應用程式，原始碼和建置說明可在 GitHub 查看，採用 AGPL-3.0-or-later 授權條款。",
      },
    ],
  },
  closing: {
    title: "下一個好想法，從這一頁開始。",
    description: "留一點時間，開啟一份 PDF。其餘的，交給專注。",
  },
  footer: {
    tagline: "給文件，也給思考，一點空間。",
    license: "開源 · AGPL-3.0-or-later",
  },
};
