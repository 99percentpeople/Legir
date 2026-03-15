const CAMEL_TO_SNAKE_PATTERN = /([a-z0-9])([A-Z])/g;
const KEY_SEPARATOR_PATTERN = /[\s-]+/g;

const LEGACY_AI_TOOL_ARG_ALIASES: Record<string, string> = {
  end_anchor: "end_inclusive_anchor",
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const toSnakeCaseKey = (key: string) =>
  key
    .replace(CAMEL_TO_SNAKE_PATTERN, "$1_$2")
    .replace(KEY_SEPARATOR_PATTERN, "_")
    .toLowerCase();

const toSnakeCaseKeysDeepInternal = (
  value: unknown,
  aliases?: Record<string, string>,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => toSnakeCaseKeysDeepInternal(item, aliases));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = toSnakeCaseKey(rawKey);
    if (!(key in normalized)) {
      normalized[key] = toSnakeCaseKeysDeepInternal(rawValue, aliases);
    }
  }

  if (aliases) {
    for (const [legacyKey, canonicalKey] of Object.entries(aliases)) {
      if (legacyKey in normalized && !(canonicalKey in normalized)) {
        normalized[canonicalKey] = normalized[legacyKey];
      }
      delete normalized[legacyKey];
    }
  }

  return normalized;
};

export const toSnakeCaseKeysDeep = <T>(value: T) =>
  toSnakeCaseKeysDeepInternal(value) as T;

export const normalizeAiToolArgsDeep = <T>(value: T) =>
  toSnakeCaseKeysDeepInternal(value, LEGACY_AI_TOOL_ARG_ALIASES) as T;
