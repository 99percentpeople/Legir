import type { LandingCopy } from "./types";

export const en: LandingCopy = {
  nav: {
    features: "Features",
    workflow: "How it works",
    faq: "Questions",
    menu: "Open navigation",
    close: "Close navigation",
    skip: "Skip to content",
    home: "Legir home",
  },
  hero: {
    eyebrow: "YOUR DOCUMENTS. YOUR SPACE.",
    title: "A little less noise.",
    accent: "A lot more clarity.",
    description:
      "A thoughtful workspace for your PDFs. Read, annotate, and fill forms — with your files right where they belong. On your device.",
    cta: "Open Legir",
    source: "View on GitHub",
    note: "Right in your browser · Local-first · Open source",
  },
  preview: {
    label: "Interactive Legir workspace demo",
    modes: {
      read: "Read",
      annotate: "Annotate",
      forms: "Fill forms",
      ai: "Ask AI",
      translate: "Translate",
    },
    caption:
      "A hands-on interface demo, not the full editor. Inputs stay in memory; AI and translation use local presets. Open Legir to work with your own PDFs.",
    appLabel: "Open Legir",
  },
  features: {
    eyebrow: "LESS FRICTION. MORE FOCUS.",
    title: "Everything your next page needs.",
    description:
      "From the first read to the final review. The tools you need, without getting in your way.",
    items: [
      {
        title: "Find your reading rhythm.",
        description:
          "Navigate with thumbnails, outlines, and search. Pick up a recent document and get straight back to the part that matters.",
      },
      {
        title: "Give your ideas a place.",
        description:
          "Highlight a passage, leave a comment, or sketch in the margins. Keep your thinking alongside the original.",
      },
      {
        title: "Less paperwork. More done.",
        description:
          "Fill or create text fields, checkboxes, and other form controls. Export your work back to PDF when you are ready.",
      },
      {
        title: "A fresh perspective, on demand.",
        description:
          "Use optional AI to explore your document. Choose your provider and configure your API key in the app settings.",
      },
    ],
    tags: [
      "A focused reading space",
      "Highlights · Notes · Drawing",
      "Fill · Create · Export",
      "Your provider. Your choice.",
    ],
  },
  privacy: {
    eyebrow: "LOCAL BY DESIGN",
    title: "Your files stay\nin your hands.",
    description:
      "Reading, annotating, and editing forms happen on your device. Your PDF does not need to make a round trip to a server for everyday work.",
    detail:
      "AI is optional. When you use an AI or translation service, relevant content is sent to the provider you configure.",
    badge: "Local-first, not cloud-required",
  },
  workflow: {
    eyebrow: "A SIMPLER WAY TO WORK",
    title: "Open. Make it yours. Carry on.",
    steps: [
      {
        title: "Bring a document",
        description: "Launch the browser app and open a PDF from your device.",
      },
      {
        title: "Work your way",
        description:
          "Read, add annotations, fill forms, or get help from your configured AI.",
      },
      {
        title: "Take your work with you",
        description:
          "Export the result as a PDF, ready for whatever comes next.",
      },
    ],
  },
  faq: {
    title: "A few things you might be wondering.",
    items: [
      {
        title: "Do I need to upload my PDF?",
        description:
          "No. The core reading, annotation, and form workflows process your document locally. Optional AI and translation services send the relevant content to your configured provider.",
      },
      {
        title: "Can I use Legir without AI?",
        description:
          "Absolutely. AI is optional. Read, navigate, annotate, and work with forms without configuring an AI provider or API key.",
      },
      {
        title: "Where can I use Legir?",
        description:
          "Open the web app in your browser. The project also includes a Tauri desktop app. The source code and build instructions are available on GitHub under the AGPL-3.0-or-later license.",
      },
    ],
  },
  closing: {
    title: "Your next good idea starts on a page.",
    description: "Give it a little space. Open a PDF in Legir.",
  },
  footer: {
    tagline: "A quieter place for your PDFs.",
    license: "Open source · AGPL-3.0-or-later",
  },
};
