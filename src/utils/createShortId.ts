const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";

/** Twelve URL-safe characters carry 72 random bits, independently of the clock. */
export const createShortId = (prefix: string) => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `${prefix}_${Array.from(bytes, (byte) => ALPHABET[byte & 63]).join("")}`;
};
