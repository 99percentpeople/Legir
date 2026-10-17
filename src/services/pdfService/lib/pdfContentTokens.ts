/** Iterate operators and intact operands; never interpret PDF strings or comments as operators. */
const isWhitespace = (char: string) => /\s/.test(char);

const isDelimiter = (char: string) =>
  ["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"].includes(char);

export function* tokenizePdfContent(content: string): Generator<string> {
  let index = 0;

  while (index < content.length) {
    const char = content[index];
    if (!char) break;

    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    if (char === "%") {
      while (index < content.length && !/[\r\n]/.test(content[index]))
        index += 1;
      continue;
    }

    if (char === "[") {
      yield "[";
      index += 1;
      continue;
    }

    if (char === "]") {
      yield "]";
      index += 1;
      continue;
    }

    if (char === "/") {
      let nextIndex = index + 1;
      while (
        nextIndex < content.length &&
        !isWhitespace(content[nextIndex] || "") &&
        !isDelimiter(content[nextIndex] || "")
      ) {
        nextIndex += 1;
      }
      yield content.slice(index, nextIndex);
      index = nextIndex;
      continue;
    }

    if (char === "(") {
      let depth = 1;
      let nextIndex = index + 1;
      let token = "";
      while (nextIndex < content.length && depth > 0) {
        const nextChar = content[nextIndex];
        if (nextChar === "\\") {
          token += nextChar;
          nextIndex += 1;
          if (nextIndex < content.length) {
            token += content[nextIndex];
            nextIndex += 1;
          }
          continue;
        }
        if (nextChar === "(") depth += 1;
        if (nextChar === ")") {
          depth -= 1;
          if (depth === 0) {
            nextIndex += 1;
            break;
          }
        }
        token += nextChar;
        nextIndex += 1;
      }
      yield `(${token})`;
      index = nextIndex;
      continue;
    }

    if (char === "<" && content[index + 1] !== "<") {
      let nextIndex = index + 1;
      while (nextIndex < content.length && content[nextIndex] !== ">") {
        nextIndex += 1;
      }
      if (nextIndex < content.length) nextIndex += 1;
      yield content.slice(index, nextIndex);
      index = nextIndex;
      continue;
    }

    if ((char === "<" || char === ">") && content[index + 1] === char) {
      yield char + char;
      index += 2;
      continue;
    }

    let nextIndex = index + 1;
    while (
      nextIndex < content.length &&
      !isWhitespace(content[nextIndex] || "") &&
      !isDelimiter(content[nextIndex] || "")
    ) {
      nextIndex += 1;
    }
    yield content.slice(index, nextIndex);
    index = nextIndex;
  }
}
