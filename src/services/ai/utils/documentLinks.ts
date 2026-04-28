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

const AI_DOCUMENT_PAGE_HASH_KEY = "page";
const AI_DOCUMENT_CONTROL_HASH_KEY = "control";
const AI_DOCUMENT_RESULT_HASH_KEY = "result";

export const buildAiDocumentPageLink = (pageNumber: number) =>
  `#${AI_DOCUMENT_PAGE_HASH_KEY}=${pageNumber}`;

export const buildAiDocumentControlLink = (controlId: string) =>
  `#${AI_DOCUMENT_CONTROL_HASH_KEY}=${encodeURIComponent(controlId)}`;

export const buildAiDocumentResultLink = (resultId: string) =>
  `#${AI_DOCUMENT_RESULT_HASH_KEY}=${encodeURIComponent(resultId)}`;

export const parseAiDocumentLinkHref = (
  rawHref: string | null,
): AiDocumentLinkTarget | null => {
  const href = rawHref?.trim();
  if (!href) return null;
  if (!href.startsWith("#")) return null;

  const params = new URLSearchParams(href.slice(1));

  const pageNumberParam = params.get(AI_DOCUMENT_PAGE_HASH_KEY);
  if (pageNumberParam !== null) {
    const pageNumber = Number(pageNumberParam);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;
    return {
      kind: "page",
      pageNumber,
    };
  }

  const controlId = params.get(AI_DOCUMENT_CONTROL_HASH_KEY)?.trim();
  if (controlId) {
    return {
      kind: "control",
      controlId,
    };
  }

  const resultId = params.get(AI_DOCUMENT_RESULT_HASH_KEY)?.trim();
  if (resultId) {
    return {
      kind: "result",
      resultId,
    };
  }

  return null;
};
