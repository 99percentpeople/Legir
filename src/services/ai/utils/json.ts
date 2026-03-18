import { z } from "zod";

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const extractJsonObject = (text: string): unknown => {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("The model returned an empty response.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch?.[1]) {
      return JSON.parse(fenceMatch[1].trim());
    }

    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      throw new Error("Failed to parse JSON response.");
    }
    return JSON.parse(objectMatch[0]);
  }
};

export const parseJsonTextWithSchema = <T>(
  text: string,
  schema: z.ZodType<T>,
  label: string,
) => {
  const parsed = extractJsonObject(text);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${label} returned invalid JSON.`);
  }
  return result.data;
};

const omitEmptyArrayFieldsDeepInternal = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => omitEmptyArrayFieldsDeepInternal(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (Array.isArray(rawValue) && rawValue.length === 0) {
      continue;
    }

    const nextValue = omitEmptyArrayFieldsDeepInternal(rawValue);
    if (Array.isArray(nextValue) && nextValue.length === 0) {
      continue;
    }

    normalized[key] = nextValue;
  }

  return normalized;
};

export const omitEmptyArrayFieldsDeep = <T>(value: T) =>
  omitEmptyArrayFieldsDeepInternal(value) as T;
