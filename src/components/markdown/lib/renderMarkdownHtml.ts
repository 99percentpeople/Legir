import DOMPurify from "dompurify";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const shouldOpenInNewTab = (href: string | null) =>
  /^(?:https?:)?\/\//i.test(href ?? "");

const sanitizeMarkdownHtml = (html: string) =>
  DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style"],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ["target", "rel"],
  });

const decorateRenderedHtml = (html: string) => {
  if (typeof document === "undefined") {
    return sanitizeMarkdownHtml(html);
  }

  const template = document.createElement("template");
  template.innerHTML = html;

  for (const table of template.content.querySelectorAll("table")) {
    const parent = table.parentElement;
    if (parent?.classList.contains("markdown-table-scroll")) {
      continue;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "markdown-table-scroll";
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  }

  const sanitizedHtml = sanitizeMarkdownHtml(template.innerHTML);
  const sanitizedTemplate = document.createElement("template");
  sanitizedTemplate.innerHTML = sanitizedHtml;

  for (const anchor of sanitizedTemplate.content.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (shouldOpenInNewTab(href)) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noreferrer noopener");
    } else {
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
    }
  }

  return sanitizedTemplate.innerHTML;
};

export const renderMarkdownToHtml = (source: string) => {
  if (!source.trim()) return "";

  try {
    return decorateRenderedHtml(
      micromark(source, {
        allowDangerousHtml: true,
        extensions: [gfm()],
        htmlExtensions: [gfmHtml()],
      }),
    );
  } catch {
    return decorateRenderedHtml(`<p>${escapeHtml(source)}</p>`);
  }
};

export const unwrapSingleParagraphHtml = (html: string) => {
  const trimmed = html.trim();
  const match = trimmed.match(/^<p>([\s\S]*)<\/p>$/);
  return match && !match[1].includes("</p>") ? match[1] : html;
};

const TRAILING_TARGET_SELECTOR = [
  "li",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote p",
  "td",
  "th",
  "pre code",
].join(", ");

export const TRAILING_ANCHOR_ATTR = "data-stream-markdown-trailing-anchor";

export const appendTrailingAnchorToHtml = (html: string) => {
  if (typeof document === "undefined" || !html.trim()) {
    return html;
  }

  const template = document.createElement("template");
  template.innerHTML = html;
  const anchor = document.createElement("span");
  anchor.setAttribute(TRAILING_ANCHOR_ATTR, "true");
  anchor.className = "inline";

  const matches = template.content.querySelectorAll(TRAILING_TARGET_SELECTOR);
  const target = matches.item(matches.length - 1);
  if (target) {
    target.appendChild(anchor);
  } else {
    template.content.appendChild(anchor);
  }

  return template.innerHTML;
};
