import type { LandingCopy } from "./types";

export const ja: LandingCopy = {
  nav: {
    features: "機能",
    workflow: "使い方",
    faq: "よくある質問",
    menu: "メニューを開く",
    close: "メニューを閉じる",
    skip: "本文へ移動",
    home: "Legir ホーム",
  },
  hero: {
    eyebrow: "あなたの文書に、集中できる場所を。",
    title: "雑音を減らして、",
    accent: "思考に余白を。",
    description:
      "PDF を読む、注釈を付ける、フォームに記入する。ファイルを自分のデバイスに置いたまま、落ち着いて作業できる場所です。",
    cta: "Legir を開く",
    source: "GitHub で見る",
    note: "ブラウザで使える · ローカル優先 · オープンソース",
  },
  preview: {
    label: "Legir ワークスペースの操作デモ",
    modes: {
      read: "読む",
      annotate: "注釈",
      forms: "フォーム",
      ai: "AI に質問",
      translate: "選択翻訳",
    },
    caption:
      "操作できる画面デモです。入力はメモリ内のみ。AI と翻訳は用意した内容を再生し、送信しません。実際の PDF 編集は Legir で。",
    appLabel: "Legir を開く",
  },
  features: {
    eyebrow: "手間を減らして、集中を深める。",
    title: "最初の一読から、最後の確認まで。",
    description: "必要な道具を手の届く場所に。文書そのものに集中できます。",
    items: [
      {
        title: "読むリズムを取り戻す。",
        description:
          "サムネイル、目次、検索で必要な場所へ。最近の文書を開いて、大切な内容にすぐ戻れます。",
      },
      {
        title: "考えを残す場所。",
        description:
          "ハイライト、コメント、手描きでアイデアを記録。自分の考えを原文のそばに残せます。",
      },
      {
        title: "フォーム作業を、もっと楽に。",
        description:
          "テキスト欄やチェックボックスなどを入力・作成。完了したら PDF に書き出して次へ進めます。",
      },
      {
        title: "必要なときに、別の視点を。",
        description:
          "任意の AI 機能で文書の理解をサポート。サービスを選び、アプリの設定で API キーを登録します。",
      },
    ],
    tags: [
      "集中できる読書空間",
      "ハイライト · メモ · 手描き",
      "入力 · 作成 · 書き出し",
      "使うサービスは自分で選ぶ",
    ],
  },
  privacy: {
    eyebrow: "設計から、ローカル優先。",
    title: "ファイルは、\nあなたの手元に。",
    description:
      "読書、注釈、フォームの編集はデバイス上で処理されます。日常の PDF 作業のために、ファイルをサーバーへ送る必要はありません。",
    detail:
      "AI は任意です。AI や翻訳サービスを使う場合、関連する内容が設定済みのサービスに送信されます。",
    badge: "クラウドを前提としない作業空間",
  },
  workflow: {
    eyebrow: "もっとシンプルな流れで。",
    title: "開く。書き込む。次へ進む。",
    steps: [
      {
        title: "文書を開く",
        description: "ブラウザアプリで、デバイス上の PDF を開きます。",
      },
      {
        title: "自分の方法で作業する",
        description:
          "読書、注釈、フォーム入力、または設定した AI で理解を深めます。",
      },
      {
        title: "成果を持ち出す",
        description: "編集結果を PDF に書き出し、次の作業へ進みます。",
      },
    ],
  },
  faq: {
    title: "使い始める前に。",
    items: [
      {
        title: "PDF をアップロードする必要はありますか？",
        description:
          "ありません。読書、注釈、フォームの基本操作はローカルで処理されます。任意の AI や翻訳サービスを使う場合のみ、関連する内容が設定したサービスへ送信されます。",
      },
      {
        title: "AI を設定せずに使えますか？",
        description:
          "はい。AI は任意です。サービスや API キーを設定しなくても、読書、移動、注釈、フォームの操作ができます。",
      },
      {
        title: "どこで使えますか？",
        description:
          "ブラウザから Web アプリを開けます。Tauri デスクトップアプリも含まれています。ソースコードとビルド手順は GitHub で公開され、ライセンスは AGPL-3.0-or-later です。",
      },
    ],
  },
  closing: {
    title: "次のアイデアは、この一頁から。",
    description: "少しの余白をつくって、Legir で PDF を開きましょう。",
  },
  footer: {
    tagline: "PDF と向き合う、静かな場所。",
    license: "オープンソース · AGPL-3.0-or-later",
  },
};
