import { z } from "zod";

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
