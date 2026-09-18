import type { LandingCopy } from "./types";

export const de: LandingCopy = {
  nav: {
    features: "Funktionen",
    workflow: "So geht’s",
    faq: "Fragen",
    menu: "Menü öffnen",
    close: "Menü schließen",
    skip: "Zum Inhalt springen",
    home: "Legir-Startseite",
  },
  hero: {
    eyebrow: "DEINE DOKUMENTE. DEIN RAUM.",
    title: "Weniger Ablenkung.",
    accent: "Mehr Klarheit.",
    description:
      "Ein ruhiger Arbeitsplatz für deine PDFs. Lesen, kommentieren und Formulare ausfüllen – mit deinen Dateien dort, wo sie hingehören: auf deinem Gerät.",
    cta: "Legir öffnen",
    source: "Auf GitHub ansehen",
    note: "Direkt im Browser · Lokal zuerst · Open Source",
  },
  preview: {
    label: "Interaktive Legir-Demo",
    modes: {
      read: "Lesen",
      annotate: "Notizen",
      forms: "Formulare",
      ai: "KI fragen",
      translate: "Übersetzen",
    },
    caption:
      "Bedienbare Oberflächendemo, kein vollständiger Editor. Eingaben bleiben im Speicher. KI und Übersetzungen sind lokale Vorlagen, ohne Versand. Eigene PDFs öffnen Sie in Legir.",
    appLabel: "Legir öffnen",
  },
  features: {
    eyebrow: "WENIGER REIBUNG. MEHR FOKUS.",
    title: "Alles für deine nächste Seite.",
    description:
      "Vom ersten Lesen bis zur letzten Prüfung. Die passenden Werkzeuge, ohne Ablenkung.",
    items: [
      {
        title: "Finde deinen Leserhythmus.",
        description:
          "Navigiere mit Miniaturen, Inhaltsverzeichnis und Suche. Öffne ein zuletzt verwendetes Dokument und finde schnell zurück.",
      },
      {
        title: "Ein Platz für deine Ideen.",
        description:
          "Markiere Text, hinterlasse Kommentare oder zeichne am Rand. Deine Gedanken bleiben direkt beim Original.",
      },
      {
        title: "Formulare ohne Umwege.",
        description:
          "Fülle oder erstelle Textfelder, Kontrollkästchen und weitere Formularfelder. Exportiere deine Arbeit anschließend als PDF.",
      },
      {
        title: "Bei Bedarf ein neuer Blick.",
        description:
          "Nutze optionale KI zum Erkunden deiner Dokumente. Wähle den Anbieter und hinterlege den API-Schlüssel in den Einstellungen.",
      },
    ],
    tags: [
      "Ein konzentrierter Leseraum",
      "Markierungen · Notizen · Zeichnen",
      "Ausfüllen · Erstellen · Exportieren",
      "Dein Anbieter. Deine Wahl.",
    ],
  },
  privacy: {
    eyebrow: "VON GRUND AUF LOKAL",
    title: "Deine Dateien bleiben\nin deiner Hand.",
    description:
      "Lesen, Kommentieren und Formularbearbeitung finden auf deinem Gerät statt. Für die tägliche Arbeit muss dein PDF nicht erst auf einen Server.",
    detail:
      "KI ist optional. Bei KI- oder Übersetzungsdiensten werden relevante Inhalte an deinen konfigurierten Anbieter gesendet.",
    badge: "Lokal zuerst, ohne Cloud-Zwang",
  },
  workflow: {
    eyebrow: "EINFACHER ARBEITEN",
    title: "Öffnen. Bearbeiten. Weitergehen.",
    steps: [
      {
        title: "Dokument mitbringen",
        description:
          "Starte die Browser-App und öffne ein PDF von deinem Gerät.",
      },
      {
        title: "Auf deine Weise arbeiten",
        description:
          "Lies, ergänze Notizen, fülle Formulare aus oder nutze die eingerichtete KI.",
      },
      {
        title: "Ergebnisse mitnehmen",
        description:
          "Exportiere das Ergebnis als PDF, bereit für den nächsten Schritt.",
      },
    ],
  },
  faq: {
    title: "Was du vielleicht noch wissen möchtest.",
    items: [
      {
        title: "Muss ich mein PDF hochladen?",
        description:
          "Nein. Lesen, Anmerkungen und Formulare werden lokal verarbeitet. Nur optionale KI- und Übersetzungsdienste senden die relevanten Inhalte an deinen eingerichteten Anbieter.",
      },
      {
        title: "Funktioniert Legir ohne KI?",
        description:
          "Ja. KI ist optional. Du kannst ohne KI-Anbieter oder API-Schlüssel lesen, navigieren, kommentieren und Formulare bearbeiten.",
      },
      {
        title: "Wo kann ich Legir verwenden?",
        description:
          "Öffne die Web-App im Browser. Zum Projekt gehört auch eine Tauri-Desktop-App. Quellcode und Bauanleitung sind auf GitHub unter der Lizenz AGPL-3.0-or-later verfügbar.",
      },
    ],
  },
  closing: {
    title: "Deine nächste gute Idee beginnt auf einer Seite.",
    description: "Gib ihr etwas Raum. Öffne ein PDF in Legir.",
  },
  footer: {
    tagline: "Ein ruhigerer Ort für deine PDFs.",
    license: "Open Source · AGPL-3.0-or-later",
  },
};
