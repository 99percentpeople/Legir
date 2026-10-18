import type { AiResultPage } from "./types";

/** Slice a deterministically ordered result set with a bounded payload. */
export const paginateAiResults = <T>(
  items: T[],
  options: { offset?: number; maxResults?: number },
  limits = { default: 100, max: 500 },
): AiResultPage & { items: T[] } => {
  const offset = Number.isSafeInteger(options.offset)
    ? Math.max(0, options.offset!)
    : 0;
  const limit = Math.min(
    limits.max,
    Number.isFinite(options.maxResults)
      ? Math.max(1, Math.trunc(options.maxResults!))
      : limits.default,
  );
  const page = items.slice(offset, offset + limit);
  const nextOffset =
    offset + page.length < items.length ? offset + page.length : null;
  return {
    total: items.length,
    returned: page.length,
    offset,
    nextOffset,
    truncated: nextOffset !== null,
    items: page,
  };
};
