const isWhitespace = (ch: string) =>
  ch === " " || ch === "\n" || ch === "\r" || ch === "\t";

const isHexDigit = (ch: string) => {
  const code = ch.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 70) || // A-F
    (code >= 97 && code <= 102) // a-f
  );
};

const decodeJsonStringEscape = (ch: string): string | null => {
  switch (ch) {
    case '"':
    case "\\":
    case "/":
      return ch;
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    default:
      return null;
  }
};

type ExtractorMode =
  | "search_key"
  | "search_colon"
  | "search_value_quote"
  | "in_value"
  | "done";

// Best-effort incremental extractor for a JSON string field value.
// It is designed for streaming LLM output of the shape:
// { "message": "...", ... }
export class JsonStringFieldStreamExtractor {
  private readonly keyToken: string;
  private keyIndex = 0;
  private mode: ExtractorMode = "search_key";
  private escaped = false;
  private unicodeDigitsRemaining = 0;
  private unicodeBuffer = "";
  private pendingHighSurrogate: number | null = null;
  private value = "";

  constructor(fieldName: string) {
    this.keyToken = `"${fieldName}"`;
  }

  getValue() {
    return this.value;
  }

  isDone() {
    return this.mode === "done";
  }

  push(chunk: string): string {
    if (!chunk) return "";

    let deltaOut = "";

    for (let i = 0; i < chunk.length; i += 1) {
      const ch = chunk[i]!;

      if (this.mode === "done") break;

      if (this.mode === "search_key") {
        if (ch === this.keyToken[this.keyIndex]) {
          this.keyIndex += 1;
          if (this.keyIndex >= this.keyToken.length) {
            this.mode = "search_colon";
            this.keyIndex = 0;
          }
          continue;
        }

        this.keyIndex = ch === this.keyToken[0] ? 1 : 0;
        continue;
      }

      if (this.mode === "search_colon") {
        if (isWhitespace(ch)) continue;
        if (ch === ":") {
          this.mode = "search_value_quote";
          continue;
        }

        // Unexpected token, fall back to scanning again.
        this.mode = "search_key";
        this.keyIndex = ch === this.keyToken[0] ? 1 : 0;
        continue;
      }

      if (this.mode === "search_value_quote") {
        if (isWhitespace(ch)) continue;
        if (ch === '"') {
          this.mode = "in_value";
          this.escaped = false;
          this.unicodeDigitsRemaining = 0;
          this.unicodeBuffer = "";
          this.pendingHighSurrogate = null;
          continue;
        }

        // The target field is expected to be a string; abort extraction on mismatch.
        this.mode = "done";
        continue;
      }

      // in_value
      if (this.unicodeDigitsRemaining > 0) {
        if (isHexDigit(ch)) {
          this.unicodeBuffer += ch;
          this.unicodeDigitsRemaining -= 1;

          if (this.unicodeDigitsRemaining === 0) {
            const codeUnit = Number.parseInt(this.unicodeBuffer, 16);
            this.unicodeBuffer = "";

            if (
              this.pendingHighSurrogate !== null &&
              codeUnit >= 0xdc00 &&
              codeUnit <= 0xdfff
            ) {
              const high = this.pendingHighSurrogate;
              this.pendingHighSurrogate = null;
              const codePoint =
                0x10000 + ((high - 0xd800) << 10) + (codeUnit - 0xdc00);
              const decoded = String.fromCodePoint(codePoint);
              this.value += decoded;
              deltaOut += decoded;
              continue;
            }

            if (this.pendingHighSurrogate !== null) {
              // Unmatched surrogate; emit it as-is and continue with current unit.
              const decodedHigh = String.fromCharCode(
                this.pendingHighSurrogate,
              );
              this.pendingHighSurrogate = null;
              this.value += decodedHigh;
              deltaOut += decodedHigh;
            }

            if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
              // High surrogate, wait for next \uXXXX.
              this.pendingHighSurrogate = codeUnit;
              continue;
            }

            const decoded = String.fromCharCode(codeUnit);
            this.value += decoded;
            deltaOut += decoded;
          }
          continue;
        }

        // Invalid unicode escape; reset and continue parsing.
        this.unicodeDigitsRemaining = 0;
        this.unicodeBuffer = "";
      }

      if (this.escaped) {
        this.escaped = false;

        if (ch === "u") {
          this.unicodeDigitsRemaining = 4;
          this.unicodeBuffer = "";
          continue;
        }

        const decoded = decodeJsonStringEscape(ch);
        if (decoded !== null) {
          this.value += decoded;
          deltaOut += decoded;
        } else {
          // Unknown escape; emit raw.
          this.value += ch;
          deltaOut += ch;
        }
        continue;
      }

      if (ch === "\\") {
        this.escaped = true;
        continue;
      }

      if (ch === '"') {
        if (this.pendingHighSurrogate !== null) {
          const decodedHigh = String.fromCharCode(this.pendingHighSurrogate);
          this.pendingHighSurrogate = null;
          this.value += decodedHigh;
          deltaOut += decodedHigh;
        }
        this.mode = "done";
        continue;
      }

      this.value += ch;
      deltaOut += ch;
    }

    return deltaOut;
  }
}
