export const AI_DOCUMENT_LINK_BASE_PATH = "/document";

export type AiDocumentLinkTarget =
  | {
      kind: "page";
      pageNumber: number;
    }
  | {
      kind: "control";
      controlId: string;
    }
  | {
      kind: "result";
      resultId: string;
    };

export const buildAiDocumentPageLink = (pageNumber: number) =>
  `${AI_DOCUMENT_LINK_BASE_PATH}/page/${pageNumber}`;

export const buildAiDocumentControlLink = (controlId: string) =>
  `${AI_DOCUMENT_LINK_BASE_PATH}/control/${encodeURIComponent(controlId)}`;

export const buildAiDocumentResultLink = (resultId: string) =>
  `${AI_DOCUMENT_LINK_BASE_PATH}/result/${encodeURIComponent(resultId)}`;

export const parseAiDocumentLinkHref = (
  rawHref: string | null,
): AiDocumentLinkTarget | null => {
  const href = rawHref?.trim();
  if (!href) return null;

  let url: URL;
  try {
    url = new URL(href, "https://formforge.local");
  } catch {
    return null;
  }

  const normalizedPath = url.pathname.replace(/\/+$/, "");
  if (
    normalizedPath !== AI_DOCUMENT_LINK_BASE_PATH &&
    !normalizedPath.startsWith(`${AI_DOCUMENT_LINK_BASE_PATH}/`)
  ) {
    return null;
  }

  const segments = normalizedPath
    .slice(AI_DOCUMENT_LINK_BASE_PATH.length)
    .split("/")
    .filter(Boolean);
  const kind = segments[0];
  const encodedValue = segments[1];
  if (!kind || !encodedValue) return null;

  if (kind === "page") {
    const pageNumber = Number.parseInt(encodedValue, 10);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;
    return {
      kind: "page",
      pageNumber,
    };
  }

  const value = decodeURIComponent(encodedValue).trim();
  if (!value) return null;

  if (kind === "control") {
    return {
      kind: "control",
      controlId: value,
    };
  }

  if (kind === "result") {
    return {
      kind: "result",
      resultId: value,
    };
  }

  return null;
};
