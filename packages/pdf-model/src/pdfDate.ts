/**
 * Parses a PDF date string (e.g., "D:20231209120000+00'00'") into an ISO 8601 string.
 * @param dateStr The raw PDF date string.
 * @returns The ISO 8601 date string, or undefined if parsing fails.
 */
export const parsePDFDate = (
  dateStr: string | undefined,
): string | undefined => {
  if (!dateStr) return undefined;
  try {
    // Remove D: prefix
    const str = dateStr.startsWith("D:") ? dateStr.substring(2) : dateStr;
    // Standard format: YYYYMMDDHHmmSS

    if (str.length >= 14) {
      const year = str.substring(0, 4);
      const month = str.substring(4, 6);
      const day = str.substring(6, 8);
      const hour = str.substring(8, 10);
      const minute = str.substring(10, 12);
      const second = str.substring(12, 14);

      // Construct ISO string with Timezone
      let iso = `${year}-${month}-${day}T${hour}:${minute}:${second}`;

      if (str.length > 14) {
        const rest = str.substring(14);
        if (rest.startsWith("Z")) {
          iso += "Z";
        } else if (rest.startsWith("+") || rest.startsWith("-")) {
          // Handle format: +HH'mm' or +HHmm or +HH
          const sign = rest.charAt(0);
          const tzPart = rest.substring(1).replace(/'/g, "");

          let tzHour = "00";
          let tzMinute = "00";

          if (tzPart.length >= 2) {
            tzHour = tzPart.substring(0, 2);
            if (tzPart.length >= 4) {
              tzMinute = tzPart.substring(2, 4);
            }
          }
          iso += `${sign}${tzHour}:${tzMinute}`;
        }
      }

      return iso;
    }
    return undefined;
  } catch {
    return undefined;
  }
};
