import type { Language } from "@/components/language-provider";

export interface DownloadCopy {
  nav: string;
  cta: string;
  eyebrow: string;
  title: string;
  description: string;
  loading: string;
  unpublished: string;
  unavailable: string;
  missing: string;
  releases: string;
  retry: string;
  current: string;
  chooseArch: string;
  installer: string;
  downloadInstaller: string;
  portable: string;
  portableNote: string;
  windowsNote: string;
  macosNote: string;
  linuxNote: string;
  linuxPortableNote: string;
  signingNote: string;
}

export const downloadCopy: Record<Exclude<Language, "system">, DownloadCopy> = {
  en: {
    nav: "Downloads",
    cta: "Get the desktop app",
    eyebrow: "ON YOUR DESKTOP",
    title: "A home for your PDFs.",
    description:
      "Download Legir for your computer, or keep working in your browser. Your files stay local for everyday PDF work.",
    loading: "Checking the latest desktop release…",
    unpublished:
      "The first desktop release is being prepared. The web app is ready to use.",
    unavailable:
      "Release information is temporarily unavailable. Check GitHub Releases or use the web app.",
    missing:
      "No download is available for this platform in the latest release.",
    releases: "All releases & checksums",
    retry: "Try again",
    current: "Your system",
    chooseArch: "Choose the architecture that matches your computer.",
    installer: "Installer",
    downloadInstaller: "Download installer",
    portable: "No-install",
    portableNote:
      "No-install packages still store settings in your normal per-user app data directory.",
    windowsNote: "x64 · EXE or portable ZIP. The ZIP requires WebView2.",
    macosNote: "Apple Silicon or Intel · DMG or a complete .app archive",
    linuxNote: "x64 or ARM64 · DEB installer / native ELF executable",
    linuxPortableNote:
      "ELF requires system WebKitGTK 4.1 and GTK 3. Grant execute permission with chmod +x before running.",
    signingNote:
      "Early builds may not be code-signed or notarized. Your system may show a security warning; check the release notes before installing.",
  },
  "zh-CN": {
    nav: "下载",
    cta: "下载桌面版",
    eyebrow: "在桌面上，继续阅读",
    title: "给你的 PDF 一个专属空间。",
    description:
      "下载适合你电脑的 Legir，或继续使用网页版。日常 PDF 阅读与编辑在本地完成。",
    loading: "正在检查最新桌面版本…",
    unpublished: "首个桌面版本正在准备中，现在可以直接使用网页版。",
    unavailable: "暂时无法获取版本信息，请查看 GitHub Releases 或使用网页版。",
    missing: "最新版本尚未提供此平台的下载文件。",
    releases: "全部版本与校验文件",
    retry: "重新检查",
    current: "当前系统",
    chooseArch: "请选择与你的电脑匹配的处理器架构。",
    installer: "安装版",
    downloadInstaller: "下载安装版",
    portable: "免安装版",
    portableNote:
      "免安装版的设置仍保存在当前用户的数据目录，不随程序文件夹移动。",
    windowsNote: "x64 · EXE 安装版 / ZIP 免安装版，后者需已安装 WebView2",
    macosNote: "Apple Silicon 或 Intel · DMG / 完整 .app 压缩包",
    linuxNote: "x64 或 ARM64 · DEB 安装版 / 原生 ELF 可执行文件",
    linuxPortableNote:
      "ELF 需系统已安装 WebKitGTK 4.1 和 GTK 3，运行前请用 chmod +x 赋予执行权限。",
    signingNote:
      "早期版本可能尚未完成代码签名或公证，安装时可能出现系统安全提示，请先阅读版本说明。",
  },
  "zh-TW": {
    nav: "下載",
    cta: "下載桌面版",
    eyebrow: "在桌面上，繼續閱讀",
    title: "給你的 PDF 一個專屬空間。",
    description:
      "下載適合你電腦的 Legir，或繼續使用網頁版。日常 PDF 閱讀與編輯在本機完成。",
    loading: "正在檢查最新桌面版本…",
    unpublished: "首個桌面版本正在準備中，現在可以直接使用網頁版。",
    unavailable: "暫時無法取得版本資訊，請查看 GitHub Releases 或使用網頁版。",
    missing: "最新版本尚未提供此平台的下載檔案。",
    releases: "所有版本與校驗檔案",
    retry: "重新檢查",
    current: "目前系統",
    chooseArch: "請選擇與你的電腦相符的處理器架構。",
    installer: "安裝版",
    downloadInstaller: "下載安裝版",
    portable: "免安裝版",
    portableNote:
      "免安裝版的設定仍儲存在目前使用者的資料目錄，不隨程式資料夾移動。",
    windowsNote: "x64 · EXE 安裝版 / ZIP 免安裝版，後者需已安裝 WebView2",
    macosNote: "Apple Silicon 或 Intel · DMG / 完整 .app 壓縮檔",
    linuxNote: "x64 或 ARM64 · DEB 安裝版 / 原生 ELF 執行檔",
    linuxPortableNote:
      "ELF 需系統已安裝 WebKitGTK 4.1 和 GTK 3，執行前請用 chmod +x 賦予執行權限。",
    signingNote:
      "早期版本可能尚未完成程式碼簽章或公證，安裝時可能出現系統安全提示，請先閱讀版本說明。",
  },
  ja: {
    nav: "ダウンロード",
    cta: "デスクトップ版を入手",
    eyebrow: "デスクトップでも",
    title: "PDF のための、専用の場所。",
    description:
      "お使いのパソコンに Legir をダウンロードするか、ブラウザーで続けられます。日常の PDF 作業はローカルで完結します。",
    loading: "最新のデスクトップ版を確認中…",
    unpublished: "最初のデスクトップ版を準備中です。Web 版は今すぐ使えます。",
    unavailable:
      "リリース情報を取得できません。GitHub Releases を確認するか、Web 版をご利用ください。",
    missing: "最新リリースには、この OS 向けのダウンロードがありません。",
    releases: "すべてのリリースとチェックサム",
    retry: "再確認",
    current: "お使いの OS",
    chooseArch: "パソコンに合ったプロセッサーの種類を選んでください。",
    installer: "インストール版",
    downloadInstaller: "インストール版を入手",
    portable: "インストール不要",
    portableNote:
      "インストール不要版も、設定は通常のユーザーデータフォルダーに保存されます。",
    windowsNote: "x64 · EXE / インストール不要の ZIP（WebView2 が必要）",
    macosNote: "Apple Silicon / Intel · DMG / 完全な .app アーカイブ",
    linuxNote: "x64 / ARM64 · DEB / ネイティブ ELF 実行ファイル",
    linuxPortableNote:
      "ELF にはシステムの WebKitGTK 4.1 と GTK 3 が必要です。実行前に chmod +x で実行権限を付与してください。",
    signingNote:
      "初期リリースはコード署名や公証が未完了の場合があります。セキュリティ警告が表示されることがあるため、インストール前にリリースノートをご確認ください。",
  },
  fr: {
    nav: "Téléchargements",
    cta: "Télécharger l’application",
    eyebrow: "SUR VOTRE ORDINATEUR",
    title: "Un espace pour vos PDF.",
    description:
      "Installez Legir sur votre ordinateur ou continuez dans le navigateur. Les opérations PDF courantes restent locales.",
    loading: "Recherche de la dernière version…",
    unpublished:
      "La première version de bureau est en préparation. La version web est déjà disponible.",
    unavailable:
      "Les informations de version sont indisponibles. Consultez GitHub Releases ou utilisez la version web.",
    missing: "Aucun téléchargement pour ce système dans la dernière version.",
    releases: "Versions et sommes de contrôle",
    retry: "Réessayer",
    current: "Votre système",
    chooseArch: "Choisissez l’architecture de votre ordinateur.",
    installer: "Installation",
    downloadInstaller: "Télécharger l’installateur",
    portable: "Sans installation",
    portableNote:
      "Les versions sans installation conservent les réglages dans le dossier habituel de données de l’utilisateur.",
    windowsNote: "x64 · EXE ou ZIP sans installation (WebView2 requis)",
    macosNote: "Apple Silicon ou Intel · DMG ou archive .app complète",
    linuxNote: "x64 ou ARM64 · DEB / exécutable ELF natif",
    linuxPortableNote:
      "ELF nécessite WebKitGTK 4.1 et GTK 3 sur le système. Accordez le droit d’exécution avec chmod +x avant de lancer le fichier.",
    signingNote:
      "Les premières versions peuvent ne pas être signées ou notariées. Une alerte de sécurité peut apparaître ; consultez les notes de version avant l’installation.",
  },
  de: {
    nav: "Downloads",
    cta: "Desktop-App herunterladen",
    eyebrow: "AUF DEINEM DESKTOP",
    title: "Ein Zuhause für deine PDFs.",
    description:
      "Lade Legir für deinen Computer herunter oder arbeite im Browser weiter. Alltägliche PDF-Aufgaben bleiben lokal.",
    loading: "Neueste Desktop-Version wird geprüft…",
    unpublished:
      "Die erste Desktop-Version wird vorbereitet. Die Web-App ist bereits verfügbar.",
    unavailable:
      "Versionsinformationen sind gerade nicht verfügbar. Sieh auf GitHub Releases nach oder nutze die Web-App.",
    missing:
      "Für dieses System gibt es in der neuesten Version keinen Download.",
    releases: "Alle Versionen & Prüfsummen",
    retry: "Erneut prüfen",
    current: "Dein System",
    chooseArch: "Wähle die passende Prozessorarchitektur für deinen Computer.",
    installer: "Installation",
    downloadInstaller: "Installer herunterladen",
    portable: "Ohne Installation",
    portableNote:
      "Auch die Versionen ohne Installation speichern Einstellungen im üblichen Benutzerdatenverzeichnis.",
    windowsNote: "x64 · EXE oder ZIP ohne Installation (WebView2 erforderlich)",
    macosNote: "Apple Silicon oder Intel · DMG oder vollständiges .app-Archiv",
    linuxNote: "x64 oder ARM64 · DEB / native ELF-Datei",
    linuxPortableNote:
      "ELF benötigt WebKitGTK 4.1 und GTK 3 auf dem System. Erteile vor dem Start mit chmod +x die Ausführungsberechtigung.",
    signingNote:
      "Frühe Versionen sind möglicherweise noch nicht signiert oder notarisiert. Das System kann eine Sicherheitswarnung anzeigen. Lies vor der Installation die Versionshinweise.",
  },
  es: {
    nav: "Descargas",
    cta: "Descargar la aplicación",
    eyebrow: "EN TU ESCRITORIO",
    title: "Un espacio para tus PDF.",
    description:
      "Descarga Legir para tu ordenador o sigue en el navegador. El trabajo habitual con PDF se realiza de forma local.",
    loading: "Buscando la última versión de escritorio…",
    unpublished:
      "La primera versión de escritorio está en preparación. La versión web ya está disponible.",
    unavailable:
      "No se pudo consultar la versión. Visita GitHub Releases o utiliza la versión web.",
    missing: "La última versión no incluye descargas para este sistema.",
    releases: "Versiones y sumas de verificación",
    retry: "Reintentar",
    current: "Tu sistema",
    chooseArch: "Elige la arquitectura de tu ordenador.",
    installer: "Instalador",
    downloadInstaller: "Descargar instalador",
    portable: "Sin instalación",
    portableNote:
      "Las versiones sin instalación también guardan los ajustes en la carpeta habitual de datos del usuario.",
    windowsNote: "x64 · EXE o ZIP sin instalación (requiere WebView2)",
    macosNote: "Apple Silicon o Intel · DMG o archivo .app completo",
    linuxNote: "x64 o ARM64 · DEB / ejecutable ELF nativo",
    linuxPortableNote:
      "ELF requiere WebKitGTK 4.1 y GTK 3 en el sistema. Concede permiso de ejecución con chmod +x antes de abrir el archivo.",
    signingNote:
      "Las primeras versiones pueden no estar firmadas o notarizadas. El sistema podría mostrar una advertencia de seguridad; lee las notas de la versión antes de instalar.",
  },
};

export function getDownloadCopy(language: string): DownloadCopy {
  return Object.prototype.hasOwnProperty.call(downloadCopy, language)
    ? downloadCopy[language as keyof typeof downloadCopy]
    : downloadCopy.en;
}
