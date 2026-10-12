import type { Matrix as MatrixType } from "./types.js";

export const Matrix = {
  identity: [1, 0, 0, 1, 0, 0] as MatrixType,
  scale: (x: number, y: number): MatrixType => [x, 0, 0, y, 0, 0],
  concat(a: MatrixType, b: MatrixType): MatrixType {
    return [
      a[0] * b[0] + a[1] * b[2],
      a[0] * b[1] + a[1] * b[3],
      a[2] * b[0] + a[3] * b[2],
      a[2] * b[1] + a[3] * b[3],
      a[4] * b[0] + a[5] * b[2] + b[4],
      a[4] * b[1] + a[5] * b[3] + b[5],
    ];
  },
  invert(m: MatrixType): MatrixType {
    const d = m[0] * m[3] - m[1] * m[2];
    if (!Number.isFinite(d) || Math.abs(d) < 1e-20)
      throw new Error("Singular PDF matrix.");
    return [
      m[3] / d,
      -m[1] / d,
      -m[2] / d,
      m[0] / d,
      (m[2] * m[5] - m[3] * m[4]) / d,
      (m[1] * m[4] - m[0] * m[5]) / d,
    ];
  },
};
