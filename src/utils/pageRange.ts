export type ParsePageRangeResult =
  | { ok: true; pageIndices: number[] }
  | {
      ok: false;
      errorKey:
        | "properties.form_detection.err_format"
        | "properties.form_detection.err_bounds";
    };

/** Page numbers are one-based in input and zero-based in the returned selection. */
export function parsePageRange(
  input: string,
  totalPages: number,
  options: { empty?: "all" | "none" } = {},
): ParsePageRangeResult {
  const raw = input.trim();
  if (!raw && options.empty === "none") return { ok: true, pageIndices: [] };
  if (!raw || raw.toLowerCase() === "all")
    return {
      ok: true,
      pageIndices: Array.from({ length: totalPages }, (_, i) => i),
    };
  const pages = new Set<number>();
  for (const part of raw.split(/[,，]/).filter((part) => part.trim())) {
    const match = part.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if (!match)
      return { ok: false, errorKey: "properties.form_detection.err_format" };
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end
    )
      return { ok: false, errorKey: "properties.form_detection.err_format" };
    if (start < 1 || end > totalPages)
      return { ok: false, errorKey: "properties.form_detection.err_bounds" };
    for (let n = start; n <= end; n++) pages.add(n - 1);
  }
  return pages.size
    ? { ok: true, pageIndices: [...pages].sort((a, b) => a - b) }
    : { ok: false, errorKey: "properties.form_detection.err_format" };
}

export function formatPageRange(pageIndices: Iterable<number>): string {
  const pages = [...new Set(pageIndices)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const start = pages[i];
    let end = start;
    while (pages[i + 1] === end + 1) end = pages[++i];
    ranges.push(start === end ? String(start + 1) : `${start + 1}-${end + 1}`);
  }
  return ranges.join(", ");
}
