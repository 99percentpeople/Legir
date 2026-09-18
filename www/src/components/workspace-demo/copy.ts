import type { PreviewMode } from "../../content/types";
import type { AnswerKind, TranslationId } from "./types";

type DemoCopy = {
  badge: string;
  reset: string;
  hints: Record<PreviewMode, string>;
  name: string;
  email: string;
  note: string;
  reviewed: string;
  aiNotice: string;
  placeholder: string;
  prompts: [string, string];
  answers: Record<AnswerKind, string>;
  source: string;
  selection: string;
  target: string;
  languageName: string;
  translateNotice: string;
  unsupported: string;
  preset: string;
  translated: string;
  translations: Record<TranslationId, string>;
};

const en: DemoCopy = {
  badge: "Interactive demo",
  reset: "Reset demo",
  hints: {
    read: "Turn a page, adjust the zoom, or explore the outline.",
    annotate:
      "Toggle the yellow highlighter. Your note stays beside the document.",
    forms:
      "Fill the actual demo fields. Switch views without losing your entries.",
    ai: "Try a suggested question and watch the local response play back.",
    translate:
      "Click the sample sentence to preview a fixed selection and its translation.",
  },
  name: "Reviewer",
  email: "Email",
  note: "One thought to take with you",
  reviewed: "I have reviewed this document.",
  aiNotice:
    "DeepSeek demo · Scripted answers and simulated token counts; no API requests.",
  placeholder: "Ask about the sample (local demo)…",
  prompts: ["Summarize this document", "Suggest three next steps"],
  answers: {
    summary:
      "This document is about reading with intention.\n\nPause before moving on, highlight a useful passage, and record a question in the margins. The review form on page 2 gives those ideas a place to stay.",
    actions:
      "1. Start with one question before reading.\n2. Highlight a passage worth returning to.\n3. Record your next step in the review form on page 2.",
    selection:
      "The selected text is attached above. This demo uses scripted responses, not live analysis. Try the document summary to see the assistant workflow.",
    fallback:
      "This is an offline interface demo, so I have not sent or analysed your question. Try one of the suggested questions, or open Legir and configure your own provider for a real conversation.",
  },
  source: "Page 1 · Reading notes",
  selection: "Selected text",
  target: "Translate to",
  languageName: "English",
  translateNotice:
    "Local translation demo · Curated excerpts only; no text is sent.",
  unsupported:
    "This selection is not one of the prepared excerpts. Try the sample sentence below; live translation is available in the app with your configured provider.",
  preset: "Try a sample selection",
  translated: "Translation",
  translations: {
    quote: "Reading is not just taking in words. It is making space to think.",
    intro: "Read carefully. Leave a note. Keep what matters.",
    paragraph:
      "The best ideas rarely arrive when we rush. They take shape in the margins, between a sentence worth keeping and a question worth asking.",
  },
};
const zhCN: DemoCopy = {
  badge: "交互演示",
  reset: "重置演示",
  hints: {
    read: "试试切换页面、调整缩放，或展开文档大纲。",
    annotate: "点击黄色高亮按钮，切换标记；批注会留在文档旁。",
    forms: "这里的表单可以直接填写，切换视图也不会丢失输入。",
    ai: "点击示例问题，体验回答逐字显示和引用跳转。",
    translate: "点击示例句子，查看固定选区与译文；选区手柄仅作展示。",
  },
  name: "审阅人",
  email: "邮箱",
  note: "记下一个值得保留的想法",
  reviewed: "我已阅读这份文档。",
  aiNotice: "DeepSeek 界面演示 · 回答与 Token 统计均为本地模拟，不发送请求。",
  placeholder: "询问示例文档（本地演示）…",
  prompts: ["总结这份文档", "给出三个行动建议"],
  answers: {
    summary:
      "这份文档讨论如何更有意识地阅读。\n\n先停下来思考，再高亮值得保留的段落，把自己的问题记在页边。第 2 页的审阅表单，可以帮你把阅读中的想法转化为下一步行动。",
    actions:
      "1. 阅读前，先带着一个问题。\n2. 高亮一段值得再次阅读的文字。\n3. 在第 2 页的表单里，记录一个具体的下一步。",
    selection:
      "选中的文字已附在上方。这里使用预设回答，不会实时分析任意选区。试试“总结这份文档”，体验完整的助手流程。",
    fallback:
      "这里是离线界面演示，你的问题没有发送或交给模型分析。可以试试上方的示例问题；真实对话请打开 Legir，并配置自己的模型服务。",
  },
  source: "第 1 页 · 阅读笔记",
  selection: "选中文字",
  target: "翻译为",
  languageName: "简体中文",
  translateNotice: "本地翻译演示 · 仅回放预置句子的译文，不发送所选内容。",
  unsupported:
    "这个选区不在预置译文中。请试用下方的示例句子；任意划词翻译需要在应用中配置自己的服务。",
  preset: "试用示例划词",
  translated: "译文",
  translations: {
    quote: "阅读不仅是接收文字，更是为思考留出空间。",
    intro: "认真阅读，留下笔记，保留重要的内容。",
    paragraph:
      "最好的想法很少在匆忙中出现。它们在页边的留白中逐渐成形，在值得保留的一句话与值得提出的一个问题之间。",
  },
};
const zhTW: DemoCopy = {
  badge: "互動示範",
  reset: "重設示範",
  hints: {
    read: "試試切換頁面、調整縮放，或展開文件大綱。",
    annotate: "點擊黃色螢光筆，切換標記；註解會留在文件旁。",
    forms: "直接填寫表單，切換檢視也不會遺失輸入。",
    ai: "點擊範例問題，體驗逐字回答和引用跳轉。",
    translate: "點擊範例句子，查看固定選取範圍與譯文；選取控制點僅供展示。",
  },
  name: "審閱人",
  email: "電子郵件",
  note: "記下一個值得保留的想法",
  reviewed: "我已閱讀這份文件。",
  aiNotice: "DeepSeek 介面示範 · 回答與 Token 統計皆為本機模擬，不傳送請求。",
  placeholder: "詢問範例文件（本機示範）…",
  prompts: ["摘要這份文件", "提供三個行動建議"],
  answers: {
    summary:
      "這份文件討論如何更有意識地閱讀。\n\n先停下來思考，再標記值得保留的段落，把自己的問題記在頁邊。第 2 頁的審閱表單，能幫助你把閱讀中的想法轉化為下一步行動。",
    actions:
      "1. 閱讀前，先帶著一個問題。\n2. 標記一段值得重讀的文字。\n3. 在第 2 頁的表單裡，記錄具體的下一步。",
    selection:
      "所選文字已附在上方。這是預設回答，不會即時分析任意選取範圍。請試試文件摘要。",
    fallback:
      "這是離線介面示範，問題沒有傳送給模型。請試用範例問題；實際對話請開啟 Legir 並設定自己的模型服務。",
  },
  source: "第 1 頁 · 閱讀筆記",
  selection: "所選文字",
  target: "翻譯為",
  languageName: "繁體中文",
  translateNotice: "本機翻譯示範 · 僅顯示預置句子的譯文，不傳送所選內容。",
  unsupported:
    "此選取範圍沒有預置譯文。請試用下方範例；任意文字翻譯需要在應用程式中設定服務。",
  preset: "試用範例選取",
  translated: "譯文",
  translations: {
    quote: "閱讀不僅是接收文字，更是為思考留出空間。",
    intro: "認真閱讀，留下筆記，保留重要的內容。",
    paragraph:
      "最好的想法很少在匆忙中出現。它們在頁邊留白逐漸成形，在值得保留的一句話與值得提出的一個問題之間。",
  },
};
const ja: DemoCopy = {
  badge: "操作デモ",
  reset: "デモをリセット",
  hints: {
    read: "ページ移動、ズーム、目次を試してみましょう。",
    annotate: "黄色のハイライトボタンでマークを切り替えます。",
    forms: "フォームに入力できます。表示を切り替えても入力は残ります。",
    ai: "質問例を選んで、回答の再生と引用への移動を試せます。",
    translate: "サンプル文をクリックすると、固定の選択範囲と訳文を表示します。",
  },
  name: "確認者",
  email: "メール",
  note: "覚えておきたい考え",
  reviewed: "この文書を確認しました。",
  aiNotice: "DeepSeek デモ · 回答とトークン数はローカルで再現。API 通信なし。",
  placeholder: "サンプルについて質問（ローカルデモ）…",
  prompts: ["文書を要約して", "次の行動を3つ提案して"],
  answers: {
    summary:
      "この文書は、意識的に読むことについて説明しています。\n\n立ち止まって考え、大切な箇所をマークし、余白に問いを残します。2ページ目のフォームで、考えを次の行動につなげられます。",
    actions:
      "1. 読む前に問いを一つ持つ。\n2. 読み返したい箇所をマークする。\n3. 2ページ目のフォームに次の行動を記す。",
    selection:
      "選択した文を添付しました。このデモは定型回答で、任意の選択範囲を分析しません。要約の質問例をお試しください。",
    fallback:
      "これはオフラインデモです。質問は送信・分析されていません。質問例を試すか、Legir でモデルを設定して実際に対話してください。",
  },
  source: "1ページ · 読書メモ",
  selection: "選択したテキスト",
  target: "翻訳先",
  languageName: "日本語",
  translateNotice:
    "ローカル翻訳デモ · 用意した訳文のみ。テキストを送信しません。",
  unsupported:
    "この選択範囲の訳文は用意されていません。下のサンプルを試してください。任意の文の翻訳はアプリで設定できます。",
  preset: "サンプル文を選択",
  translated: "訳文",
  translations: {
    quote:
      "読むことは、ただ言葉を取り入れるだけではありません。考えるための余白をつくることです。",
    intro: "丁寧に読み、メモを残し、大切なことを保ちましょう。",
    paragraph:
      "よい考えは、急いでいるときにはなかなか生まれません。残したい一文と問いかけたい疑問のあいだ、余白の中で形になります。",
  },
};
const fr: DemoCopy = {
  badge: "Démo interactive",
  reset: "Réinitialiser",
  hints: {
    read: "Changez de page, zoomez ou explorez le sommaire.",
    annotate: "Activez le surligneur jaune pour marquer le passage.",
    forms:
      "Remplissez les champs. Vos saisies restent lorsque vous changez de vue.",
    ai: "Essayez une question proposée et la lecture progressive de la réponse.",
    translate:
      "Cliquez sur la phrase exemple pour afficher une sélection fixe et sa traduction.",
  },
  name: "Relecteur",
  email: "E-mail",
  note: "Une idée à retenir",
  reviewed: "J’ai relu ce document.",
  aiNotice:
    "Démo DeepSeek · Réponses et compteurs de tokens simulés, sans appel API.",
  placeholder: "Une question sur l’exemple (démo locale)…",
  prompts: ["Résumer ce document", "Proposer trois prochaines étapes"],
  answers: {
    summary:
      "Ce document invite à lire avec attention.\n\nPrenez le temps de réfléchir, surlignez un passage utile et notez une question dans la marge. Le formulaire de la page 2 aide à transformer ces idées en actions.",
    actions:
      "1. Commencez par une question.\n2. Surlignez un passage à relire.\n3. Notez votre prochaine étape dans le formulaire de la page 2.",
    selection:
      "Le texte sélectionné est joint ci-dessus. Cette démo ne l’analyse pas : elle utilise des réponses prédéfinies. Essayez le résumé du document.",
    fallback:
      "Ceci est une démo hors ligne. Votre question n’a pas été envoyée ni analysée. Essayez une question proposée, ou configurez votre fournisseur dans Legir pour une vraie conversation.",
  },
  source: "Page 1 · Notes de lecture",
  selection: "Texte sélectionné",
  target: "Traduire en",
  languageName: "Français",
  translateNotice:
    "Démo locale · Extraits prédéfinis uniquement, sans envoi de texte.",
  unsupported:
    "Cet extrait n’a pas de traduction prédéfinie. Essayez la phrase exemple. La traduction libre nécessite votre service configuré dans l’application.",
  preset: "Sélectionner un exemple",
  translated: "Traduction",
  translations: {
    quote:
      "Lire, ce n’est pas seulement assimiler des mots. C’est faire de la place à la réflexion.",
    intro: "Lisez attentivement. Prenez une note. Gardez l’essentiel.",
    paragraph:
      "Les meilleures idées viennent rarement dans la précipitation. Elles prennent forme dans les marges, entre une phrase à retenir et une question à poser.",
  },
};
const de: DemoCopy = {
  badge: "Interaktive Demo",
  reset: "Zurücksetzen",
  hints: {
    read: "Blättern Sie, ändern Sie den Zoom oder öffnen Sie die Gliederung.",
    annotate: "Schalten Sie die Markierung mit dem gelben Textmarker um.",
    forms:
      "Füllen Sie die Felder aus. Eingaben bleiben beim Ansichtswechsel erhalten.",
    ai: "Wählen Sie eine Beispielfrage und erleben Sie die schrittweise Antwort.",
    translate:
      "Klicken Sie auf den Beispielsatz, um die feste Auswahl und ihre Übersetzung zu sehen.",
  },
  name: "Prüfer",
  email: "E-Mail",
  note: "Ein Gedanke zum Mitnehmen",
  reviewed: "Ich habe das Dokument geprüft.",
  aiNotice:
    "DeepSeek-Demo · Antworten und Token-Zähler simuliert, keine API-Aufrufe.",
  placeholder: "Frage zum Beispiel (lokale Demo)…",
  prompts: ["Dokument zusammenfassen", "Drei nächste Schritte vorschlagen"],
  answers: {
    summary:
      "Dieses Dokument handelt vom bewussten Lesen.\n\nHalten Sie inne, markieren Sie wichtige Stellen und notieren Sie Fragen am Rand. Das Formular auf Seite 2 hilft, daraus konkrete nächste Schritte zu machen.",
    actions:
      "1. Beginnen Sie mit einer Frage.\n2. Markieren Sie eine lesenswerte Passage.\n3. Notieren Sie den nächsten Schritt im Formular auf Seite 2.",
    selection:
      "Die Auswahl ist oben angehängt. Diese Demo analysiert keinen beliebigen Text, sondern zeigt vorgefertigte Antworten. Testen Sie die Zusammenfassung.",
    fallback:
      "Dies ist eine Offline-Demo. Ihre Frage wurde weder gesendet noch analysiert. Testen Sie eine Beispielfrage oder richten Sie in Legir Ihren Anbieter für echte Gespräche ein.",
  },
  source: "Seite 1 · Lesenotizen",
  selection: "Ausgewählter Text",
  target: "Übersetzen in",
  languageName: "Deutsch",
  translateNotice:
    "Lokale Übersetzungsdemo · Nur vorbereitete Auszüge, kein Textversand.",
  unsupported:
    "Für diese Auswahl gibt es keine vorbereitete Übersetzung. Testen Sie den Beispielsatz. Freie Übersetzungen erfordern einen eingerichteten Anbieter in der App.",
  preset: "Beispieltext auswählen",
  translated: "Übersetzung",
  translations: {
    quote:
      "Lesen bedeutet nicht nur, Wörter aufzunehmen. Es bedeutet, Raum zum Denken zu schaffen.",
    intro:
      "Lesen Sie aufmerksam. Machen Sie eine Notiz. Bewahren Sie das Wesentliche.",
    paragraph:
      "Die besten Ideen kommen selten in der Eile. Sie entstehen am Rand, zwischen einem Satz, den man behalten möchte, und einer Frage, die es sich zu stellen lohnt.",
  },
};
const es: DemoCopy = {
  badge: "Demo interactiva",
  reset: "Reiniciar demo",
  hints: {
    read: "Cambia de página, ajusta el zoom o explora el índice.",
    annotate: "Activa el marcador amarillo para resaltar el pasaje.",
    forms: "Rellena los campos. Tus entradas se conservan al cambiar de vista.",
    ai: "Prueba una pregunta sugerida y la reproducción gradual de la respuesta.",
    translate:
      "Haz clic en la frase de ejemplo para ver una selección fija y su traducción.",
  },
  name: "Revisor",
  email: "Correo",
  note: "Una idea para recordar",
  reviewed: "He revisado este documento.",
  aiNotice:
    "Demo de DeepSeek · Respuestas y recuentos de tokens simulados, sin llamadas API.",
  placeholder: "Pregunta sobre el ejemplo (demo local)…",
  prompts: ["Resumir este documento", "Sugerir tres próximos pasos"],
  answers: {
    summary:
      "Este documento trata de leer con intención.\n\nDetente a pensar, resalta un pasaje útil y anota una pregunta al margen. El formulario de la página 2 ayuda a convertir esas ideas en próximos pasos.",
    actions:
      "1. Empieza con una pregunta.\n2. Resalta un pasaje que merezca otra lectura.\n3. Anota el próximo paso en el formulario de la página 2.",
    selection:
      "El texto seleccionado se adjunta arriba. Esta demo no analiza selecciones arbitrarias: utiliza respuestas preparadas. Prueba el resumen.",
    fallback:
      "Esta es una demo sin conexión. Tu pregunta no se ha enviado ni analizado. Prueba una pregunta sugerida o configura tu proveedor en Legir para una conversación real.",
  },
  source: "Página 1 · Notas de lectura",
  selection: "Texto seleccionado",
  target: "Traducir a",
  languageName: "Español",
  translateNotice:
    "Demo local de traducción · Solo extractos preparados, sin enviar texto.",
  unsupported:
    "No hay una traducción preparada para esta selección. Prueba la frase de ejemplo. La traducción libre requiere configurar un proveedor en la aplicación.",
  preset: "Seleccionar un ejemplo",
  translated: "Traducción",
  translations: {
    quote: "Leer no es solo asimilar palabras. Es crear espacio para pensar.",
    intro: "Lee con atención. Deja una nota. Conserva lo importante.",
    paragraph:
      "Las mejores ideas rara vez llegan cuando vamos con prisa. Toman forma en los márgenes, entre una frase que merece conservarse y una pregunta que merece hacerse.",
  },
};
export const demoCopy: Record<string, DemoCopy> = {
  en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ja,
  fr,
  de,
  es,
};
export function getDemoCopy(language: string): DemoCopy {
  return Object.hasOwn(demoCopy, language) ? demoCopy[language] : en;
}
export type { DemoCopy };
