export type PreviewMode =
  | "read"
  | "annotate"
  | "forms"
  | "ai"
  | "translate"
  | "pages";

export const PREVIEW_MODES: PreviewMode[] = [
  "read",
  "annotate",
  "forms",
  "ai",
  "translate",
  "pages",
];

type TextBlock = { title: string; description: string };

export interface LandingCopy {
  nav: {
    features: string;
    workflow: string;
    faq: string;
    menu: string;
    close: string;
    skip: string;
    home: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    accent: string;
    description: string;
    cta: string;
    source: string;
  };
  preview: {
    label: string;
    modes: Record<PreviewMode, string>;
    appLabel: string;
  };
  features: {
    eyebrow: string;
    title: string;
    description: string;
    items: [TextBlock, TextBlock, TextBlock, TextBlock, TextBlock];
    tags: [string, string, string, string, string];
  };
  privacy: {
    eyebrow: string;
    title: string;
    description: string;
    detail: string;
    badge: string;
  };
  workflow: {
    eyebrow: string;
    title: string;
    steps: [TextBlock, TextBlock, TextBlock];
  };
  faq: { title: string; items: [TextBlock, TextBlock, TextBlock] };
  closing: TextBlock;
  footer: { tagline: string; license: string };
}
