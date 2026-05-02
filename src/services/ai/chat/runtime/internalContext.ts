const MAX_INTERNAL_CONTEXT_VALUE_CHARS = 20_000;
const MAX_INTERNAL_CONTEXT_DEPTH = 8;

const OMITTED_CONTEXT_VALUE = "[omitted large binary data]";
const CIRCULAR_CONTEXT_VALUE = "[omitted circular value]";
const DEEP_CONTEXT_VALUE = "[omitted deeply nested value]";

const BINARY_FIELD_NAMES = new Set([
  "arrayBuffer",
  "array_buffer",
  "base64",
  "base64Data",
  "base64_data",
  "blob",
  "buffer",
  "bytes",
  "dataUrl",
  "data_url",
  "imageData",
  "image_data",
]);

const looksLikeBase64Payload = (text: string) =>
  text.length > 4096 && /^[A-Za-z0-9+/=\r\n]+$/.test(text);

const shouldOmitContextString = (key: string | undefined, text: string) => {
  if (BINARY_FIELD_NAMES.has(key ?? "")) return true;
  if (text.startsWith("data:")) return true;
  if ((key === "src" || key === "image") && looksLikeBase64Payload(text)) {
    return true;
  }
  return looksLikeBase64Payload(text);
};

const sanitizeInternalContextValue = (
  value: unknown,
  key?: string,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown => {
  if (depth > MAX_INTERNAL_CONTEXT_DEPTH) return DEEP_CONTEXT_VALUE;

  if (typeof value === "string") {
    return shouldOmitContextString(key, value) ? OMITTED_CONTEXT_VALUE : value;
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return undefined;
  if (typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }
  if (
    typeof ArrayBuffer !== "undefined" &&
    (value instanceof ArrayBuffer || ArrayBuffer.isView(value))
  ) {
    return OMITTED_CONTEXT_VALUE;
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return CIRCULAR_CONTEXT_VALUE;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeInternalContextValue(item, key, depth + 1, seen),
    );
  }

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record)
      .map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeInternalContextValue(entryValue, entryKey, depth + 1, seen),
      ])
      .filter(([, entryValue]) => typeof entryValue !== "undefined"),
  );
};

const truncateInternalContextValue = (text: string) =>
  text.length <= MAX_INTERNAL_CONTEXT_VALUE_CHARS
    ? text
    : `${text.slice(0, MAX_INTERNAL_CONTEXT_VALUE_CHARS)}\n...(truncated)`;

export const stringifyInternalContextValue = (value: unknown) => {
  const sanitized = sanitizeInternalContextValue(value);
  if (typeof sanitized === "string") {
    return truncateInternalContextValue(sanitized);
  }
  try {
    const json = JSON.stringify(sanitized, null, 2);
    if (typeof json === "string") return truncateInternalContextValue(json);
  } catch {
    // ignore
  }
  try {
    return truncateInternalContextValue(String(sanitized));
  } catch {
    return "";
  }
};

export const parseInternalContextText = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const formatInternalContextContent = (
  headerLines: string[],
  bodyLines: string[],
) => [...headerLines, ...bodyLines].filter(Boolean).join("\n");
