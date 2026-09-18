export const MATRIX_COLS = 5;
export const MATRIX_ROWS = 7;

const glyph = (...rows) => Object.freeze(rows);

function fromBits(...rows) {
  return glyph(
    ...rows.map((row) => row.toString(2).padStart(MATRIX_COLS, "0")),
  );
}

/**
 * Classic-style 5×7 dot-matrix font.
 *
 * The set covers printable ASCII used by themes and consumer overrides:
 * punctuation, numbers, A–Z and a–z. Lowercase glyphs are intentionally
 * compact so mixed-case custom ramps keep a terminal/LED appearance.
 */
const glyphs = {
  " ": fromBits(0, 0, 0, 0, 0, 0, 0),
  "!": fromBits(4, 4, 4, 4, 4, 0, 4),
  '"': fromBits(10, 10, 10, 0, 0, 0, 0),
  "#": fromBits(10, 31, 10, 10, 31, 10, 10),
  $: fromBits(4, 15, 20, 14, 5, 30, 4),
  "%": fromBits(24, 25, 2, 4, 8, 19, 3),
  "&": fromBits(12, 18, 20, 8, 21, 18, 13),
  "'": fromBits(4, 4, 8, 0, 0, 0, 0),
  "(": fromBits(2, 4, 8, 8, 8, 4, 2),
  ")": fromBits(8, 4, 2, 2, 2, 4, 8),
  "*": fromBits(0, 21, 14, 31, 14, 21, 0),
  "+": fromBits(0, 4, 4, 31, 4, 4, 0),
  ",": fromBits(0, 0, 0, 0, 0, 4, 8),
  "-": fromBits(0, 0, 0, 31, 0, 0, 0),
  ".": fromBits(0, 0, 0, 0, 0, 0, 4),
  "/": fromBits(1, 2, 2, 4, 8, 8, 16),

  0: fromBits(14, 17, 19, 21, 25, 17, 14),
  1: fromBits(4, 12, 4, 4, 4, 4, 14),
  2: fromBits(14, 17, 1, 2, 4, 8, 31),
  3: fromBits(30, 1, 1, 14, 1, 1, 30),
  4: fromBits(2, 6, 10, 18, 31, 2, 2),
  5: fromBits(31, 16, 16, 30, 1, 1, 30),
  6: fromBits(14, 16, 16, 30, 17, 17, 14),
  7: fromBits(31, 1, 2, 4, 8, 8, 8),
  8: fromBits(14, 17, 17, 14, 17, 17, 14),
  9: fromBits(14, 17, 17, 15, 1, 1, 14),

  ":": fromBits(0, 4, 0, 0, 4, 0, 0),
  ";": fromBits(0, 4, 0, 0, 4, 4, 8),
  "<": fromBits(2, 4, 8, 16, 8, 4, 2),
  "=": fromBits(0, 0, 31, 0, 31, 0, 0),
  ">": fromBits(8, 4, 2, 1, 2, 4, 8),
  "?": fromBits(14, 17, 1, 2, 4, 0, 4),
  "@": fromBits(14, 17, 23, 21, 23, 16, 14),

  A: fromBits(14, 17, 17, 31, 17, 17, 17),
  B: fromBits(30, 17, 17, 30, 17, 17, 30),
  C: fromBits(14, 17, 16, 16, 16, 17, 14),
  D: fromBits(30, 17, 17, 17, 17, 17, 30),
  E: fromBits(31, 16, 16, 30, 16, 16, 31),
  F: fromBits(31, 16, 16, 30, 16, 16, 16),
  G: fromBits(14, 17, 16, 23, 17, 17, 15),
  H: fromBits(17, 17, 17, 31, 17, 17, 17),
  I: fromBits(14, 4, 4, 4, 4, 4, 14),
  J: fromBits(7, 2, 2, 2, 2, 18, 12),
  K: fromBits(17, 18, 20, 24, 20, 18, 17),
  L: fromBits(16, 16, 16, 16, 16, 16, 31),
  M: fromBits(17, 27, 21, 21, 17, 17, 17),
  N: fromBits(17, 25, 21, 19, 17, 17, 17),
  O: fromBits(14, 17, 17, 17, 17, 17, 14),
  P: fromBits(30, 17, 17, 30, 16, 16, 16),
  Q: fromBits(14, 17, 17, 17, 21, 18, 13),
  R: fromBits(30, 17, 17, 30, 20, 18, 17),
  S: fromBits(15, 16, 16, 14, 1, 1, 30),
  T: fromBits(31, 4, 4, 4, 4, 4, 4),
  U: fromBits(17, 17, 17, 17, 17, 17, 14),
  V: fromBits(17, 17, 17, 17, 17, 10, 4),
  W: fromBits(17, 17, 17, 21, 21, 21, 10),
  X: fromBits(17, 17, 10, 4, 10, 17, 17),
  Y: fromBits(17, 17, 10, 4, 4, 4, 4),
  Z: fromBits(31, 1, 2, 4, 8, 16, 31),

  "[": fromBits(14, 8, 8, 8, 8, 8, 14),
  "\\": fromBits(16, 8, 8, 4, 2, 2, 1),
  "]": fromBits(14, 2, 2, 2, 2, 2, 14),
  "^": fromBits(4, 10, 17, 0, 0, 0, 0),
  _: fromBits(0, 0, 0, 0, 0, 0, 31),
  "`": fromBits(8, 4, 2, 0, 0, 0, 0),

  a: fromBits(0, 0, 14, 1, 15, 17, 15),
  b: fromBits(16, 16, 22, 25, 17, 17, 30),
  c: fromBits(0, 0, 14, 17, 16, 17, 14),
  d: fromBits(1, 1, 13, 19, 17, 17, 15),
  e: fromBits(0, 0, 14, 17, 31, 16, 14),
  f: fromBits(6, 9, 8, 28, 8, 8, 8),
  g: fromBits(0, 0, 15, 17, 15, 1, 14),
  h: fromBits(16, 16, 22, 25, 17, 17, 17),
  i: fromBits(4, 0, 12, 4, 4, 4, 14),
  j: fromBits(2, 0, 6, 2, 2, 18, 12),
  k: fromBits(16, 16, 18, 20, 24, 20, 18),
  l: fromBits(12, 4, 4, 4, 4, 4, 14),
  m: fromBits(0, 0, 26, 21, 21, 21, 21),
  n: fromBits(0, 0, 22, 25, 17, 17, 17),
  o: fromBits(0, 0, 14, 17, 17, 17, 14),
  p: fromBits(0, 0, 30, 17, 30, 16, 16),
  q: fromBits(0, 0, 15, 17, 15, 1, 1),
  r: fromBits(0, 0, 22, 25, 16, 16, 16),
  s: fromBits(0, 0, 15, 16, 14, 1, 30),
  t: fromBits(8, 8, 28, 8, 8, 9, 6),
  u: fromBits(0, 0, 17, 17, 17, 19, 13),
  v: fromBits(0, 0, 17, 17, 17, 10, 4),
  w: fromBits(0, 0, 17, 17, 21, 21, 10),
  x: fromBits(0, 0, 17, 10, 4, 10, 17),
  y: fromBits(0, 0, 17, 17, 15, 1, 14),
  z: fromBits(0, 0, 31, 2, 4, 8, 31),

  "{": fromBits(2, 4, 4, 8, 4, 4, 2),
  "|": fromBits(4, 4, 4, 4, 4, 4, 4),
  "}": fromBits(8, 4, 4, 2, 4, 4, 8),
  "~": fromBits(0, 0, 9, 22, 0, 0, 0),
};

export const MATRIX_GLYPHS = Object.freeze(glyphs);

export const FALLBACK_MATRIX_GLYPH = fromBits(14, 17, 1, 2, 4, 0, 4);

export function matrixGlyphFor(character) {
  return MATRIX_GLYPHS[character] || FALLBACK_MATRIX_GLYPH;
}

export function matrixGlyphCoverage() {
  return Object.keys(MATRIX_GLYPHS).sort();
}
